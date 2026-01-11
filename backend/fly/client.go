package fly

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

var baseURL = "https://api.machines.dev/v1"

type Client struct {
	token   string
	appName string
	region  string
	http    *http.Client
}

func NewClient(token, appName, region string) *Client {
	return &Client{
		token:   token,
		appName: appName,
		region:  region,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type MachineConfig struct {
	Image    string            `json:"image"`
	Guest    GuestConfig       `json:"guest"`
	Env      map[string]string `json:"env,omitempty"`
	Services []Service         `json:"services,omitempty"`
	Mounts   []Mount           `json:"mounts,omitempty"`
}

type Mount struct {
	Volume string `json:"volume"`
	Path   string `json:"path"`
}

type GuestConfig struct {
	CPUKind  string `json:"cpu_kind,omitempty"`
	CPUs     int    `json:"cpus,omitempty"`
	MemoryMB int    `json:"memory_mb,omitempty"`
	GPUKind  string `json:"gpu_kind,omitempty"`
}

type Service struct {
	Ports        []Port `json:"ports"`
	Protocol     string `json:"protocol"`
	InternalPort int    `json:"internal_port"`
}

type Port struct {
	Port     int      `json:"port"`
	Handlers []string `json:"handlers"`
}

type Machine struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	State      string        `json:"state"`
	Region     string        `json:"region"`
	InstanceID string        `json:"instance_id"`
	PrivateIP  string        `json:"private_ip"`
	Config     MachineConfig `json:"config"`
	CreatedAt  string        `json:"created_at"`
	UpdatedAt  string        `json:"updated_at"`
}

type CreateMachineRequest struct {
	Name   string        `json:"name,omitempty"`
	Region string        `json:"region,omitempty"`
	Config MachineConfig `json:"config"`
}

type APIError struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

func (c *Client) doRequest(method, path string, body interface{}) ([]byte, error) {
	url := fmt.Sprintf("%s/apps/%s%s", baseURL, c.appName, path)

	var reqBody io.Reader
	var jsonBodyStr string
	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		jsonBodyStr = string(jsonBody)
		reqBody = bytes.NewReader(jsonBody)
	}

	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		log.Printf("Fly API error: %s %s status=%d body=%s response=%s", method, path, resp.StatusCode, jsonBodyStr, string(respBody))
		var apiErr APIError
		if json.Unmarshal(respBody, &apiErr) == nil && apiErr.Error != "" {
			return nil, fmt.Errorf("API error (%d): %s - %s", resp.StatusCode, apiErr.Error, apiErr.Message)
		}
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

func (c *Client) CreateMachine(name string, config MachineConfig) (*Machine, error) {
	region := c.region
	// GPU machines must be created in ord region
	if config.Guest.GPUKind != "" {
		region = "ord"
	}

	req := CreateMachineRequest{
		Name:   name,
		Region: region,
		Config: config,
	}

	respBody, err := c.doRequest("POST", "/machines", req)
	if err != nil {
		return nil, err
	}

	var machine Machine
	if err := json.Unmarshal(respBody, &machine); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &machine, nil
}

func (c *Client) GetMachine(machineID string) (*Machine, error) {
	respBody, err := c.doRequest("GET", "/machines/"+machineID, nil)
	if err != nil {
		return nil, err
	}

	var machine Machine
	if err := json.Unmarshal(respBody, &machine); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &machine, nil
}

func (c *Client) StartMachine(machineID string) error {
	_, err := c.doRequest("POST", "/machines/"+machineID+"/start", nil)
	return err
}

func (c *Client) StopMachine(machineID string) error {
	_, err := c.doRequest("POST", "/machines/"+machineID+"/stop", nil)
	return err
}

func (c *Client) DeleteMachine(machineID string) error {
	_, err := c.doRequest("DELETE", "/machines/"+machineID, nil)
	return err
}

func (c *Client) ListMachines() ([]Machine, error) {
	respBody, err := c.doRequest("GET", "/machines", nil)
	if err != nil {
		return nil, err
	}

	var machines []Machine
	if err := json.Unmarshal(respBody, &machines); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return machines, nil
}

func (c *Client) WaitForState(machineID string, desiredState string, timeout time.Duration) error {
	// Use Fly.io's native /wait endpoint instead of polling
	waitURL, err := url.Parse(baseURL)
	if err != nil {
		return fmt.Errorf("failed to parse base URL: %w", err)
	}
	waitURL.Path = waitURL.Path + "/apps/" + c.appName + "/machines/" + machineID + "/wait"
	query := waitURL.Query()
	query.Set("state", desiredState)
	query.Set("timeout", strconv.Itoa(int(timeout.Seconds())))
	waitURL.RawQuery = query.Encode()

	req, err := http.NewRequest("GET", waitURL.String(), nil)
	if err != nil {
		return fmt.Errorf("failed to create wait request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	// Use a longer timeout for this blocking call
	client := &http.Client{Timeout: timeout + 10*time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("wait request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		return nil
	}

	body, _ := io.ReadAll(resp.Body)
	return fmt.Errorf("wait failed (%d): %s", resp.StatusCode, string(body))
}

func (c *Client) GetAppName() string {
	return c.appName
}

func (c *Client) GetRegion() string {
	return c.region
}

// Volume types and operations

type Volume struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Region             string `json:"region"`
	SizeGB             int    `json:"size_gb"`
	State              string `json:"state"`
	AttachedMachineID  string `json:"attached_machine_id,omitempty"`
	AttachedAllocID    string `json:"attached_alloc_id,omitempty"`
	CreatedAt          string `json:"created_at"`
	Encrypted          bool   `json:"encrypted"`
	FSType             string `json:"fstype,omitempty"`
	SnapshotRetention  int    `json:"snapshot_retention,omitempty"`
}

type CreateVolumeRequest struct {
	Name              string `json:"name"`
	Region            string `json:"region"`
	SizeGB            int    `json:"size_gb"`
	Encrypted         bool   `json:"encrypted,omitempty"`
	RequireUniqueZone bool   `json:"require_unique_zone,omitempty"`
	FSType            string `json:"fstype,omitempty"`
}

func (c *Client) CreateVolume(name string, sizeGB int, region string) (*Volume, error) {
	req := CreateVolumeRequest{
		Name:      name,
		Region:    region,
		SizeGB:    sizeGB,
		Encrypted: true,
		FSType:    "ext4",
	}

	respBody, err := c.doRequest("POST", "/volumes", req)
	if err != nil {
		return nil, err
	}

	var volume Volume
	if err := json.Unmarshal(respBody, &volume); err != nil {
		return nil, fmt.Errorf("failed to parse volume response: %w", err)
	}

	return &volume, nil
}

func (c *Client) GetVolume(volumeID string) (*Volume, error) {
	respBody, err := c.doRequest("GET", "/volumes/"+volumeID, nil)
	if err != nil {
		return nil, err
	}

	var volume Volume
	if err := json.Unmarshal(respBody, &volume); err != nil {
		return nil, fmt.Errorf("failed to parse volume response: %w", err)
	}

	return &volume, nil
}

func (c *Client) DeleteVolume(volumeID string) error {
	_, err := c.doRequest("DELETE", "/volumes/"+volumeID, nil)
	return err
}

func (c *Client) ListVolumes() ([]Volume, error) {
	respBody, err := c.doRequest("GET", "/volumes", nil)
	if err != nil {
		return nil, err
	}

	var volumes []Volume
	if err := json.Unmarshal(respBody, &volumes); err != nil {
		return nil, fmt.Errorf("failed to parse volumes response: %w", err)
	}

	return volumes, nil
}
