package proxy

import (
	"sync"
	"time"
)

// CacheEntry holds cached project information
type CacheEntry struct {
	ProjectID string
	PrivateIP string
	ExpiresAt time.Time
}

// ProjectCache provides fast lookups with TTL-based expiration
type ProjectCache struct {
	entries map[string]*CacheEntry
	mu      sync.RWMutex
	ttl     time.Duration
}

// NewProjectCache creates a new cache with the specified TTL
func NewProjectCache(ttl time.Duration) *ProjectCache {
	cache := &ProjectCache{
		entries: make(map[string]*CacheEntry),
		ttl:     ttl,
	}

	// Start background cleanup goroutine
	go cache.cleanupLoop()

	return cache
}

// Get retrieves a cache entry by project ID prefix
// Returns the entry and true if found and not expired, nil and false otherwise
func (c *ProjectCache) Get(prefix string) (*CacheEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.entries[prefix]
	if !exists {
		return nil, false
	}

	// Check if entry has expired
	if time.Now().After(entry.ExpiresAt) {
		return nil, false
	}

	return entry, true
}

// Set stores a cache entry for the given project ID prefix
func (c *ProjectCache) Set(prefix, projectID, privateIP string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[prefix] = &CacheEntry{
		ProjectID: projectID,
		PrivateIP: privateIP,
		ExpiresAt: time.Now().Add(c.ttl),
	}
}

// Invalidate removes a cache entry for the given prefix
func (c *ProjectCache) Invalidate(prefix string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.entries, prefix)
}

// InvalidateByProjectID removes all cache entries for a given project ID
// Useful when a project is stopped or its machine changes
func (c *ProjectCache) InvalidateByProjectID(projectID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for prefix, entry := range c.entries {
		if entry.ProjectID == projectID {
			delete(c.entries, prefix)
		}
	}
}

// cleanupLoop periodically removes expired entries
func (c *ProjectCache) cleanupLoop() {
	ticker := time.NewTicker(c.ttl / 2)
	defer ticker.Stop()

	for range ticker.C {
		c.cleanup()
	}
}

// cleanup removes all expired entries
func (c *ProjectCache) cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for prefix, entry := range c.entries {
		if now.After(entry.ExpiresAt) {
			delete(c.entries, prefix)
		}
	}
}

// Size returns the current number of entries in the cache
func (c *ProjectCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}
