package validation

import (
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

// CreateProjectInput represents validated create project input
type CreateProjectInput struct {
	Name        string
	Description *string
}

// ValidateCreateProject validates create project request
func ValidateCreateProject(name, description string) (*CreateProjectInput, ValidationErrors) {
	var errors ValidationErrors

	if err := ValidateProjectName(name); err != nil {
		errors = append(errors, *err)
	}

	if description != "" {
		if err := ValidateProjectDescription(description); err != nil {
			errors = append(errors, *err)
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
