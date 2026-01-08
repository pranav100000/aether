package validation

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

var (
	// Project name: alphanumeric, dashes, underscores, 1-100 chars
	projectNameRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$`)
)

type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e *ValidationError) Error() string {
	return e.Field + ": " + e.Message
}

type ValidationErrors []ValidationError

func (e ValidationErrors) Error() string {
	if len(e) == 0 {
		return ""
	}
	var msgs []string
	for _, err := range e {
		msgs = append(msgs, err.Error())
	}
	return strings.Join(msgs, "; ")
}

func (e ValidationErrors) HasErrors() bool {
	return len(e) > 0
}

// ValidateProjectName validates project name format
func ValidateProjectName(name string) *ValidationError {
	if name == "" {
		return &ValidationError{Field: "name", Message: "is required"}
	}
	if len(name) > 100 {
		return &ValidationError{Field: "name", Message: "must be 100 characters or less"}
	}
	if !projectNameRegex.MatchString(name) {
		return &ValidationError{Field: "name", Message: "must start with a letter or number and contain only letters, numbers, dashes, and underscores"}
	}
	return nil
}

// ValidateProjectDescription validates project description
func ValidateProjectDescription(description string) *ValidationError {
	if len(description) > 500 {
		return &ValidationError{Field: "description", Message: "must be 500 characters or less"}
	}
	return nil
}

// ValidateUUID validates UUID format
func ValidateUUID(id string, field string) *ValidationError {
	if id == "" {
		return &ValidationError{Field: field, Message: "is required"}
	}
	if _, err := uuid.Parse(id); err != nil {
		return &ValidationError{Field: field, Message: "must be a valid UUID"}
	}
	return nil
}

// ValidateFilePath validates a file path for safety
func ValidateFilePath(path string) *ValidationError {
	if path == "" {
		return &ValidationError{Field: "path", Message: "is required"}
	}

	// Check for path traversal attacks
	if strings.Contains(path, "..") {
		return &ValidationError{Field: "path", Message: "path traversal is not allowed"}
	}

	// Check for null bytes
	if strings.ContainsRune(path, 0) {
		return &ValidationError{Field: "path", Message: "invalid characters in path"}
	}

	// Path must be reasonable length
	if len(path) > 1000 {
		return &ValidationError{Field: "path", Message: "path is too long"}
	}

	return nil
}

// ValidateFileName validates a file or directory name
func ValidateFileName(name string) *ValidationError {
	if name == "" {
		return &ValidationError{Field: "name", Message: "is required"}
	}

	// Check for path separators
	if strings.ContainsAny(name, "/\\") {
		return &ValidationError{Field: "name", Message: "name cannot contain path separators"}
	}

	// Check for special names
	if name == "." || name == ".." {
		return &ValidationError{Field: "name", Message: "invalid name"}
	}

	// Check for null bytes
	if strings.ContainsRune(name, 0) {
		return &ValidationError{Field: "name", Message: "invalid characters in name"}
	}

	// Reasonable length
	if len(name) > 255 {
		return &ValidationError{Field: "name", Message: "name is too long"}
	}

	return nil
}

// HardwareConfig represents validated hardware configuration
type HardwareConfig struct {
	CPUKind      string
	CPUs         int
	MemoryMB     int
	VolumeSizeGB int
	GPUKind      *string
}

var (
	validCPUKinds = map[string]bool{"shared": true, "performance": true}
	validGPUKinds = map[string]bool{"a10": true, "l40s": true, "a100-40gb": true, "a100-80gb": true}

	// Valid CPU/Memory combinations for Fly.io
	validSharedConfigs = map[int][]int{
		1: {256, 512, 1024, 2048},
		2: {512, 1024, 2048, 4096},
		4: {1024, 2048, 4096, 8192},
		8: {2048, 4096, 8192, 16384},
	}
	validPerformanceConfigs = map[int][]int{
		1:  {2048, 4096, 8192},
		2:  {4096, 8192, 16384},
		4:  {8192, 16384, 32768},
		8:  {16384, 32768},
		16: {32768},
	}
)

// GetPresetConfig returns a preset hardware configuration
func GetPresetConfig(preset string) *HardwareConfig {
	switch preset {
	case "small":
		return &HardwareConfig{CPUKind: "shared", CPUs: 1, MemoryMB: 1024, VolumeSizeGB: 5, GPUKind: nil}
	case "medium":
		return &HardwareConfig{CPUKind: "shared", CPUs: 2, MemoryMB: 2048, VolumeSizeGB: 10, GPUKind: nil}
	case "large":
		return &HardwareConfig{CPUKind: "shared", CPUs: 4, MemoryMB: 4096, VolumeSizeGB: 20, GPUKind: nil}
	case "performance":
		return &HardwareConfig{CPUKind: "performance", CPUs: 2, MemoryMB: 4096, VolumeSizeGB: 20, GPUKind: nil}
	default:
		// Default to small
		return &HardwareConfig{CPUKind: "shared", CPUs: 1, MemoryMB: 1024, VolumeSizeGB: 5, GPUKind: nil}
	}
}

// ValidateHardwareConfig validates hardware configuration
func ValidateHardwareConfig(cpuKind string, cpus, memoryMB, volumeSizeGB int, gpuKind *string) (*HardwareConfig, ValidationErrors) {
	var errors ValidationErrors

	// Validate CPU kind
	if !validCPUKinds[cpuKind] {
		errors = append(errors, ValidationError{
			Field:   "cpu_kind",
			Message: "must be 'shared' or 'performance'",
		})
	}

	// Validate CPU count based on kind
	if cpuKind == "shared" {
		if cpus < 1 || cpus > 8 {
			errors = append(errors, ValidationError{
				Field:   "cpus",
				Message: "shared CPU must be 1, 2, 4, or 8 cores",
			})
		}
	} else if cpuKind == "performance" {
		if cpus < 1 || cpus > 16 {
			errors = append(errors, ValidationError{
				Field:   "cpus",
				Message: "performance CPU must be 1, 2, 4, 8, or 16 cores",
			})
		}
	}

	// Validate memory range
	if memoryMB < 256 || memoryMB > 32768 {
		errors = append(errors, ValidationError{
			Field:   "memory_mb",
			Message: "memory must be between 256MB and 32GB",
		})
	}

	// Validate CPU/memory combination
	if validCPUKinds[cpuKind] && memoryMB >= 256 && memoryMB <= 32768 {
		var validMemory []int
		if cpuKind == "shared" {
			validMemory = validSharedConfigs[cpus]
		} else {
			validMemory = validPerformanceConfigs[cpus]
		}

		if len(validMemory) > 0 {
			found := false
			for _, m := range validMemory {
				if m == memoryMB {
					found = true
					break
				}
			}
			if !found {
				errors = append(errors, ValidationError{
					Field:   "memory_mb",
					Message: fmt.Sprintf("invalid memory for %s CPU with %d cores; valid options: %v", cpuKind, cpus, validMemory),
				})
			}
		}
	}

	// Validate volume size
	if volumeSizeGB < 1 || volumeSizeGB > 500 {
		errors = append(errors, ValidationError{
			Field:   "volume_size_gb",
			Message: "volume size must be between 1GB and 500GB",
		})
	}

	// Validate GPU kind (if provided)
	if gpuKind != nil && *gpuKind != "" && !validGPUKinds[*gpuKind] {
		errors = append(errors, ValidationError{
			Field:   "gpu_kind",
			Message: "must be one of: a10, l40s, a100-40gb, a100-80gb",
		})
	}

	if errors.HasErrors() {
		return nil, errors
	}

	return &HardwareConfig{
		CPUKind:      cpuKind,
		CPUs:         cpus,
		MemoryMB:     memoryMB,
		VolumeSizeGB: volumeSizeGB,
		GPUKind:      gpuKind,
	}, nil
}

// CreateProjectInput represents validated create project input
type CreateProjectInput struct {
	Name        string
	Description *string
	Hardware    *HardwareConfig
}

// ValidateCreateProject validates create project request
func ValidateCreateProject(name, description string, hw *HardwareConfig) (*CreateProjectInput, ValidationErrors) {
	var errors ValidationErrors

	if err := ValidateProjectName(name); err != nil {
		errors = append(errors, *err)
	}

	if description != "" {
		if err := ValidateProjectDescription(description); err != nil {
			errors = append(errors, *err)
		}
	}

	// Use default hardware config if not provided
	if hw == nil {
		hw = GetPresetConfig("small")
	} else {
		// Validate provided hardware config
		validatedHw, hwErrors := ValidateHardwareConfig(hw.CPUKind, hw.CPUs, hw.MemoryMB, hw.VolumeSizeGB, hw.GPUKind)
		if hwErrors.HasErrors() {
			errors = append(errors, hwErrors...)
		} else {
			hw = validatedHw
		}
	}

	if errors.HasErrors() {
		return nil, errors
	}

	var desc *string
	if description != "" {
		desc = &description
	}

	return &CreateProjectInput{
		Name:        name,
		Description: desc,
		Hardware:    hw,
	}, nil
}

// UpdateProjectInput represents validated update project input
type UpdateProjectInput struct {
	Name        *string
	Description *string
}

// ValidateUpdateProject validates update project request
func ValidateUpdateProject(name, description *string) (*UpdateProjectInput, ValidationErrors) {
	var errors ValidationErrors

	if name != nil && *name != "" {
		if err := ValidateProjectName(*name); err != nil {
			errors = append(errors, *err)
		}
	}

	if description != nil && *description != "" {
		if err := ValidateProjectDescription(*description); err != nil {
			errors = append(errors, *err)
		}
	}

	if errors.HasErrors() {
		return nil, errors
	}

	return &UpdateProjectInput{
		Name:        name,
		Description: description,
	}, nil
}
