package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
)

var (
	ErrMasterKeyNotSet    = errors.New("ENCRYPTION_MASTER_KEY environment variable not set")
	ErrMasterKeyInvalid   = errors.New("ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex characters)")
	ErrCiphertextTooShort = errors.New("ciphertext too short")
	ErrDecryptionFailed   = errors.New("decryption failed")
)

// Encryptor handles AES-256-GCM encryption/decryption
type Encryptor struct {
	masterKey []byte
}

// NewEncryptor creates a new Encryptor using the ENCRYPTION_MASTER_KEY env var
func NewEncryptor() (*Encryptor, error) {
	keyHex := os.Getenv("ENCRYPTION_MASTER_KEY")
	if keyHex == "" {
		return nil, ErrMasterKeyNotSet
	}

	masterKey, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, ErrMasterKeyInvalid
	}

	if len(masterKey) != 32 {
		return nil, ErrMasterKeyInvalid
	}

	return &Encryptor{masterKey: masterKey}, nil
}

// NewEncryptorWithKey creates an Encryptor with a specific key (useful for testing)
func NewEncryptorWithKey(key []byte) (*Encryptor, error) {
	if len(key) != 32 {
		return nil, ErrMasterKeyInvalid
	}
	return &Encryptor{masterKey: key}, nil
}

// deriveKey derives a user-specific key from the master key and user ID
// This provides additional isolation between users
func (e *Encryptor) deriveKey(userID string) []byte {
	h := sha256.New()
	h.Write(e.masterKey)
	h.Write([]byte(userID))
	return h.Sum(nil)
}

// Encrypt encrypts plaintext using AES-256-GCM with a user-specific derived key
// Returns base64-encoded ciphertext (nonce prepended)
func (e *Encryptor) Encrypt(plaintext string, userID string) (string, error) {
	key := e.deriveKey(userID)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	// Generate random nonce
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	// Encrypt and prepend nonce
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)

	// Return as base64
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decrypts base64-encoded ciphertext using AES-256-GCM
func (e *Encryptor) Decrypt(ciphertextB64 string, userID string) (string, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return "", err
	}

	key := e.deriveKey(userID)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", ErrCiphertextTooShort
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", ErrDecryptionFailed
	}

	return string(plaintext), nil
}
