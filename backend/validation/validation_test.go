package validation

import (
	"strings"
	"testing"
)

func TestValidateProjectName(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
		errMsg  string
	}{
		{"valid simple", "my-project", false, ""},
		{"valid with underscore", "my_project", false, ""},
		{"valid with numbers", "project123", false, ""},
		{"valid single char", "a", false, ""},
		{"empty", "", true, "is required"},
		{"too long", strings.Repeat("a", 101), true, "must be 100 characters or less"},
		{"starts with dash", "-project", true, "must start with a letter"},
		{"starts with underscore", "_project", true, "must start with a letter"},
		{"contains spaces", "my project", true, "must start with a letter"},
		{"contains special chars", "my@project", true, "must start with a letter"},
		{"max length valid", strings.Repeat("a", 100), false, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateProjectName(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error, got nil")
				} else if !strings.Contains(err.Message, tt.errMsg) {
					t.Errorf("expected error containing %q, got %q", tt.errMsg, err.Message)
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
			}
		})
	}
}

func TestValidateProjectDescription(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"valid short", "A simple project", false},
		{"valid empty", "", false},
		{"valid max length", strings.Repeat("a", 500), false},
		{"too long", strings.Repeat("a", 501), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateProjectDescription(tt.input)
			if tt.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateUUID(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"valid uuid", "550e8400-e29b-41d4-a716-446655440000", false},
		{"empty", "", true},
		{"invalid format", "not-a-uuid", true},
		{"partial uuid", "550e8400-e29b-41d4", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateUUID(tt.input, "id")
			if tt.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateCreateProject(t *testing.T) {
	tests := []struct {
		name        string
		projName    string
		description string
		wantErr     bool
		errCount    int
	}{
		{"valid with description", "my-project", "A cool project", false, 0},
		{"valid without description", "my-project", "", false, 0},
		{"invalid name only", "", "A cool project", true, 1},
		{"invalid both", "", strings.Repeat("a", 501), true, 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input, errs := ValidateCreateProject(tt.projName, tt.description)
			if tt.wantErr {
				if !errs.HasErrors() {
					t.Error("expected errors, got none")
				}
				if len(errs) != tt.errCount {
					t.Errorf("expected %d errors, got %d", tt.errCount, len(errs))
				}
			} else {
				if errs.HasErrors() {
					t.Errorf("unexpected errors: %v", errs)
				}
				if input == nil {
					t.Error("expected input, got nil")
				}
			}
		})
	}
}
