package sftp

import (
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const (
	MaxFileSize   = 1 * 1024 * 1024 // 1MB
	WorkingDir    = "/home/coder/project"
	ConnectionTTL = 5 * time.Minute
)

type Client struct {
	privateKey ssh.Signer
	user       string
	pool       map[string]*pooledConnection
	mu         sync.RWMutex
}

type pooledConnection struct {
	sshConn    *ssh.Client
	sftpClient *sftp.Client
	lastUsed   time.Time
}

type FileEntry struct {
	Name     string    `json:"name"`
	Type     string    `json:"type"` // "file" or "directory"
	Size     int64     `json:"size,omitempty"`
	Modified time.Time `json:"modified"`
}

type FileInfo struct {
	Path     string    `json:"path"`
	Content  string    `json:"content,omitempty"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

type DirListing struct {
	Path    string      `json:"path"`
	Entries []FileEntry `json:"entries"`
}

type FileTree struct {
	Paths       []string `json:"paths"`
	Directories []string `json:"directories"`
}

// HiddenEntries are files/folders to skip when listing
var HiddenEntries = map[string]bool{
	"node_modules": true,
	".git":         true,
	"__pycache__":  true,
	".venv":        true,
	"venv":         true,
	".env":         true,
	"dist":         true,
	"build":        true,
	".next":        true,
	".cache":       true,
	".DS_Store":    true,
	"Thumbs.db":    true,
	"lost+found":   true,
}

func NewClient(privateKeyPath string, user string) (*Client, error) {
	keyBytes, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read private key: %w", err)
	}

	return NewClientFromKey(keyBytes, user)
}

func NewClientFromKey(privateKey []byte, user string) (*Client, error) {
	signer, err := ssh.ParsePrivateKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	client := &Client{
		privateKey: signer,
		user:       user,
		pool:       make(map[string]*pooledConnection),
	}

	// Start cleanup goroutine
	go client.cleanupLoop()

	return client, nil
}

func (c *Client) cleanupLoop() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		c.cleanupStaleConnections()
	}
}

func (c *Client) cleanupStaleConnections() {
	c.mu.Lock()
	defer c.mu.Unlock()

	for key, conn := range c.pool {
		if time.Since(conn.lastUsed) > ConnectionTTL {
			conn.sftpClient.Close()
			conn.sshConn.Close()
			delete(c.pool, key)
		}
	}
}

func (c *Client) getOrCreateConnection(host string, port int) (*sftp.Client, error) {
	key := fmt.Sprintf("%s:%d", host, port)

	// Try to get existing connection
	c.mu.RLock()
	if conn, ok := c.pool[key]; ok && time.Since(conn.lastUsed) < ConnectionTTL {
		conn.lastUsed = time.Now()
		c.mu.RUnlock()
		return conn.sftpClient, nil
	}
	c.mu.RUnlock()

	// Create new connection
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after acquiring write lock
	if conn, ok := c.pool[key]; ok && time.Since(conn.lastUsed) < ConnectionTTL {
		conn.lastUsed = time.Now()
		return conn.sftpClient, nil
	}

	// Close stale connection if exists
	if conn, ok := c.pool[key]; ok {
		conn.sftpClient.Close()
		conn.sshConn.Close()
		delete(c.pool, key)
	}

	return c.createConnection(host, port, key)
}

// createConnection creates a new SSH/SFTP connection (caller must hold write lock)
func (c *Client) createConnection(host string, port int, key string) (*sftp.Client, error) {
	config := &ssh.ClientConfig{
		User: c.user,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(c.privateKey),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	sshConn, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return nil, fmt.Errorf("failed to dial SSH: %w", err)
	}

	// Create SFTP client
	sftpClient, err := sftp.NewClient(sshConn)
	if err != nil {
		sshConn.Close()
		return nil, fmt.Errorf("failed to create SFTP client: %w", err)
	}

	c.pool[key] = &pooledConnection{
		sshConn:    sshConn,
		sftpClient: sftpClient,
		lastUsed:   time.Now(),
	}

	return sftpClient, nil
}

// invalidateConnection removes a stale connection from the pool and creates a new one
func (c *Client) invalidateConnection(host string, port int) (*sftp.Client, error) {
	key := fmt.Sprintf("%s:%d", host, port)

	c.mu.Lock()
	defer c.mu.Unlock()

	// Close and remove stale connection
	if conn, ok := c.pool[key]; ok {
		conn.sftpClient.Close()
		conn.sshConn.Close()
		delete(c.pool, key)
	}

	return c.createConnection(host, port, key)
}

// isConnectionError checks if an error indicates a dead connection
func isConnectionError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "connection lost") ||
		strings.Contains(errStr, "broken pipe") ||
		strings.Contains(errStr, "connection reset") ||
		strings.Contains(errStr, "EOF")
}

// resolvePath converts a relative path to absolute path within WorkingDir
func resolvePath(path string) string {
	// Clean the path to remove .. and other oddities
	path = filepath.Clean(path)

	// If path is already within WorkingDir, return as-is
	if strings.HasPrefix(path, WorkingDir) {
		return path
	}

	// Strip leading slash and treat as relative to WorkingDir
	path = strings.TrimPrefix(path, "/")

	return filepath.Join(WorkingDir, path)
}

// List returns directory contents at the given path
func (c *Client) List(host string, port int, path string) (*DirListing, error) {
	sftpClient, err := c.getOrCreateConnection(host, port)
	if err != nil {
		return nil, err
	}

	fullPath := resolvePath(path)

	entries, err := sftpClient.ReadDir(fullPath)
	if err != nil {
		// Retry once if connection error
		if isConnectionError(err) {
			sftpClient, err = c.invalidateConnection(host, port)
			if err != nil {
				return nil, err
			}
			entries, err = sftpClient.ReadDir(fullPath)
			if err != nil {
				return nil, fmt.Errorf("failed to read directory: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to read directory: %w", err)
		}
	}

	result := &DirListing{
		Path:    fullPath,
		Entries: make([]FileEntry, 0, len(entries)),
	}

	for _, entry := range entries {
		fileType := "file"
		if entry.IsDir() {
			fileType = "directory"
		}

		fe := FileEntry{
			Name:     entry.Name(),
			Type:     fileType,
			Modified: entry.ModTime(),
		}

		if !entry.IsDir() {
			fe.Size = entry.Size()
		}

		result.Entries = append(result.Entries, fe)
	}

	return result, nil
}

// ListAllFiles recursively walks the directory tree and returns all file and directory paths
func (c *Client) ListAllFiles(host string, port int) (*FileTree, error) {
	sftpClient, err := c.getOrCreateConnection(host, port)
	if err != nil {
		return nil, err
	}

	result := &FileTree{
		Paths:       make([]string, 0),
		Directories: make([]string, 0),
	}

	err = c.walkDirectory(sftpClient, WorkingDir, "", result)
	if err != nil {
		// Retry once if connection error
		if isConnectionError(err) {
			sftpClient, err = c.invalidateConnection(host, port)
			if err != nil {
				return nil, err
			}
			// Reset and retry
			result.Paths = make([]string, 0)
			result.Directories = make([]string, 0)
			err = c.walkDirectory(sftpClient, WorkingDir, "", result)
			if err != nil {
				return nil, fmt.Errorf("failed to walk directory: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to walk directory: %w", err)
		}
	}

	return result, nil
}

// walkDirectory recursively walks a directory and collects file/directory paths
func (c *Client) walkDirectory(sftpClient *sftp.Client, basePath string, relativePath string, result *FileTree) error {
	fullPath := basePath
	if relativePath != "" {
		fullPath = filepath.Join(basePath, relativePath)
	}

	entries, err := sftpClient.ReadDir(fullPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		name := entry.Name()

		// Skip hidden entries
		if HiddenEntries[name] {
			continue
		}

		// Build relative path (what frontend expects)
		var entryRelPath string
		if relativePath == "" {
			entryRelPath = "/" + name
		} else {
			entryRelPath = filepath.Join(relativePath, name)
		}

		if entry.IsDir() {
			result.Directories = append(result.Directories, entryRelPath)
			// Recurse into subdirectory
			if err := c.walkDirectory(sftpClient, basePath, entryRelPath, result); err != nil {
				// Log but continue on errors in subdirectories
				continue
			}
		} else {
			result.Paths = append(result.Paths, entryRelPath)
		}
	}

	return nil
}

// Read returns the contents of a file
func (c *Client) Read(host string, port int, path string) (*FileInfo, error) {
	sftpClient, err := c.getOrCreateConnection(host, port)
	if err != nil {
		return nil, err
	}

	fullPath := resolvePath(path)

	// Get file info first to check size
	stat, err := sftpClient.Stat(fullPath)
	if err != nil {
		// Retry once if connection error
		if isConnectionError(err) {
			sftpClient, err = c.invalidateConnection(host, port)
			if err != nil {
				return nil, err
			}
			stat, err = sftpClient.Stat(fullPath)
			if err != nil {
				return nil, fmt.Errorf("failed to stat file: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to stat file: %w", err)
		}
	}

	if stat.IsDir() {
		return nil, fmt.Errorf("path is a directory, not a file")
	}

	if stat.Size() > MaxFileSize {
		return nil, fmt.Errorf("file too large: %d bytes (max %d)", stat.Size(), MaxFileSize)
	}

	// Open and read file
	file, err := sftpClient.Open(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	// Check for binary content
	if IsBinaryContent(content) {
		return nil, fmt.Errorf("binary files cannot be edited")
	}

	return &FileInfo{
		Path:     fullPath,
		Content:  string(content),
		Size:     stat.Size(),
		Modified: stat.ModTime(),
	}, nil
}

// Write creates or updates a file with the given content
func (c *Client) Write(host string, port int, path string, content []byte) (*FileInfo, error) {
	sftpClient, err := c.getOrCreateConnection(host, port)
	if err != nil {
		return nil, err
	}

	if len(content) > MaxFileSize {
		return nil, fmt.Errorf("content too large: %d bytes (max %d)", len(content), MaxFileSize)
	}

	fullPath := resolvePath(path)

	// Ensure parent directory exists
	parentDir := filepath.Dir(fullPath)
	if err := sftpClient.MkdirAll(parentDir); err != nil {
		// Retry once if connection error
		if isConnectionError(err) {
			sftpClient, err = c.invalidateConnection(host, port)
			if err != nil {
				return nil, err
			}
			if err := sftpClient.MkdirAll(parentDir); err != nil {
				return nil, fmt.Errorf("failed to create parent directory: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to create parent directory: %w", err)
		}
	}

	// Create/overwrite file
	file, err := sftpClient.Create(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create file: %w", err)
	}
	defer file.Close()

	_, err = file.Write(content)
	if err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	// Get updated file info
	stat, err := sftpClient.Stat(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file after write: %w", err)
	}

	return &FileInfo{
		Path:     fullPath,
		Size:     stat.Size(),
		Modified: stat.ModTime(),
	}, nil
}

// Mkdir creates a directory (and any necessary parents)
func (c *Client) Mkdir(host string, port int, path string) error {
	sftpClient, err := c.getOrCreateConnection(host, port)
	if err != nil {
		return err
	}

	fullPath := resolvePath(path)

	if err := sftpClient.MkdirAll(fullPath); err != nil {
		// Retry once if connection error
		if isConnectionError(err) {
			sftpClient, err = c.invalidateConnection(host, port)
			if err != nil {
				return err
			}
			if err := sftpClient.MkdirAll(fullPath); err != nil {
				return fmt.Errorf("failed to create directory: %w", err)
			}
		} else {
			return fmt.Errorf("failed to create directory: %w", err)
		}
	}

	return nil
}

// Delete removes a file or directory (directories must be empty)
func (c *Client) Delete(host string, port int, path string) error {
	sftpClient, err := c.getOrCreateConnection(host, port)
	if err != nil {
		return err
	}

	fullPath := resolvePath(path)

	// Check if it's a directory
	stat, err := sftpClient.Stat(fullPath)
	if err != nil {
		// Retry once if connection error
		if isConnectionError(err) {
			sftpClient, err = c.invalidateConnection(host, port)
			if err != nil {
				return err
			}
			stat, err = sftpClient.Stat(fullPath)
			if err != nil {
				return fmt.Errorf("failed to stat path: %w", err)
			}
		} else {
			return fmt.Errorf("failed to stat path: %w", err)
		}
	}

	if stat.IsDir() {
		// For directories, use RemoveDirectory (requires empty dir)
		// or recursively delete
		return c.deleteRecursive(sftpClient, fullPath)
	}

	// For files, just remove
	if err := sftpClient.Remove(fullPath); err != nil {
		return fmt.Errorf("failed to delete file: %w", err)
	}

	return nil
}

func (c *Client) deleteRecursive(sftpClient *sftp.Client, path string) error {
	entries, err := sftpClient.ReadDir(path)
	if err != nil {
		return fmt.Errorf("failed to read directory: %w", err)
	}

	for _, entry := range entries {
		entryPath := filepath.Join(path, entry.Name())
		if entry.IsDir() {
			if err := c.deleteRecursive(sftpClient, entryPath); err != nil {
				return err
			}
		} else {
			if err := sftpClient.Remove(entryPath); err != nil {
				return fmt.Errorf("failed to delete %s: %w", entryPath, err)
			}
		}
	}

	// Remove the now-empty directory
	if err := sftpClient.RemoveDirectory(path); err != nil {
		return fmt.Errorf("failed to remove directory %s: %w", path, err)
	}

	return nil
}

// Rename moves/renames a file or directory
func (c *Client) Rename(host string, port int, oldPath, newPath string) error {
	sftpClient, err := c.getOrCreateConnection(host, port)
	if err != nil {
		return err
	}

	fullOldPath := resolvePath(oldPath)
	fullNewPath := resolvePath(newPath)

	// Ensure parent directory of new path exists
	parentDir := filepath.Dir(fullNewPath)
	if err := sftpClient.MkdirAll(parentDir); err != nil {
		// Retry once if connection error
		if isConnectionError(err) {
			sftpClient, err = c.invalidateConnection(host, port)
			if err != nil {
				return err
			}
			if err := sftpClient.MkdirAll(parentDir); err != nil {
				return fmt.Errorf("failed to create parent directory: %w", err)
			}
		} else {
			return fmt.Errorf("failed to create parent directory: %w", err)
		}
	}

	if err := sftpClient.Rename(fullOldPath, fullNewPath); err != nil {
		return fmt.Errorf("failed to rename: %w", err)
	}

	return nil
}

// Stat returns file/directory info without reading content
func (c *Client) Stat(host string, port int, path string) (*FileInfo, error) {
	sftpClient, err := c.getOrCreateConnection(host, port)
	if err != nil {
		return nil, err
	}

	fullPath := resolvePath(path)

	stat, err := sftpClient.Stat(fullPath)
	if err != nil {
		// Retry once if connection error
		if isConnectionError(err) {
			sftpClient, err = c.invalidateConnection(host, port)
			if err != nil {
				return nil, err
			}
			stat, err = sftpClient.Stat(fullPath)
			if err != nil {
				return nil, fmt.Errorf("failed to stat: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to stat: %w", err)
		}
	}

	return &FileInfo{
		Path:     fullPath,
		Size:     stat.Size(),
		Modified: stat.ModTime(),
	}, nil
}

// Close closes all pooled connections
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	for key, conn := range c.pool {
		conn.sftpClient.Close()
		conn.sshConn.Close()
		delete(c.pool, key)
	}
}

// IsBinaryContent checks if content appears to be binary (contains null bytes)
func IsBinaryContent(content []byte) bool {
	// Check first 8000 bytes for null bytes (common heuristic)
	checkLen := len(content)
	if checkLen > 8000 {
		checkLen = 8000
	}

	for i := 0; i < checkLen; i++ {
		if content[i] == 0 {
			return true
		}
	}
	return false
}
