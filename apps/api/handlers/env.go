package handlers

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
)

// EnvBuilder builds environment variables for machines and agents
type EnvBuilder struct {
	apiKeys APIKeysGetter
}

// NewEnvBuilder creates a new EnvBuilder
func NewEnvBuilder(apiKeys APIKeysGetter) *EnvBuilder {
	return &EnvBuilder{apiKeys: apiKeys}
}

// BuildEnv builds environment variables with common settings
// extraVars are merged into the result (can override defaults)
func (b *EnvBuilder) BuildEnv(ctx context.Context, projectID, userID string, extraVars map[string]string) map[string]string {
	env := map[string]string{
		"PROJECT_ID": projectID,
	}

	// Merge extra vars first so platform/user keys can override
	for k, v := range extraVars {
		env[k] = v
	}

	// Inject platform-level API keys
	if codebuffKey := os.Getenv("CODEBUFF_API_KEY"); codebuffKey != "" {
		env["CODEBUFF_API_KEY"] = codebuffKey
	}

	// Inject user's API keys if available
	if b.apiKeys != nil {
		apiKeys, err := b.apiKeys.GetDecryptedKeys(ctx, userID)
		if err != nil {
			log.Printf("Warning: failed to get API keys for user %s: %v", userID, err)
		} else if apiKeys != nil {
			for envName, key := range apiKeys {
				env[envName] = key
			}
		}
	}

	return env
}

// BuildAgentEnv builds environment variables for an agent with derived keys
func (b *EnvBuilder) BuildAgentEnv(ctx context.Context, projectID, userID string) map[string]string {
	env := b.BuildEnv(ctx, projectID, userID, map[string]string{
		"STORAGE_DIR": "/home/coder/workspace/.aether",
		"PROJECT_CWD": "/home/coder/workspace/project",
	})

	// Add derived keys for specific SDKs
	if openaiKey, ok := env["OPENAI_API_KEY"]; ok {
		env["CODEX_API_KEY"] = openaiKey
	}
	if openrouterKey, ok := env["OPENROUTER_API_KEY"]; ok {
		env["CODEBUFF_BYOK_OPENROUTER"] = openrouterKey
	}

	return env
}

// ToEnvFileContent creates shell export statements from env vars
func ToEnvFileContent(env map[string]string) string {
	var sb strings.Builder
	for k, v := range env {
		sb.WriteString(fmt.Sprintf("export %s=%q\n", k, v))
	}
	return sb.String()
}
