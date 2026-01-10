//go:build linux

package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

// Netlink constants for SOCK_DIAG
const (
	NETLINK_SOCK_DIAG   = 4
	SOCK_DIAG_BY_FAMILY = 20
	TCPF_LISTEN         = 1 << 10 // TCP_LISTEN state
)

// InetDiagReqV2 is the request structure for SOCK_DIAG_BY_FAMILY
type InetDiagReqV2 struct {
	Family   uint8
	Protocol uint8
	Ext      uint8
	Pad      uint8
	States   uint32
	ID       InetDiagSockID
}

// InetDiagSockID identifies a socket
type InetDiagSockID struct {
	Sport  [2]byte // Network byte order
	Dport  [2]byte
	Src    [16]byte
	Dst    [16]byte
	If     uint32
	Cookie [2]uint32
}

// InetDiagMsg is the response message
type InetDiagMsg struct {
	Family  uint8
	State   uint8
	Timer   uint8
	Retrans uint8
	ID      InetDiagSockID
	Expires uint32
	Rqueue  uint32
	Wqueue  uint32
	UID     uint32
	Inode   uint32
}

// Ignored ports (system services)
var ignoredPorts = map[uint16]bool{
	22:   true, // SSH
	2222: true, // Our SSH port
}

func main() {
	fmt.Fprintf(os.Stderr, "port-watcher: starting\n")
	currentPorts := make(map[uint16]bool)

	// Initial scan - output all currently listening ports
	ports, err := getListeningPorts()
	if err != nil {
		fmt.Fprintf(os.Stderr, "port-watcher: initial scan failed: %v\n", err)
	}
	fmt.Fprintf(os.Stderr, "port-watcher: found %d listening ports\n", len(ports))
	for _, port := range ports {
		if !ignoredPorts[port] {
			currentPorts[port] = true
			fmt.Printf("LISTEN %d\n", port)
		}
	}
	os.Stdout.Sync()

	// Monitor every 500ms
	ticker := time.NewTicker(500 * time.Millisecond)
	for range ticker.C {
		ports, err := getListeningPorts()
		if err != nil {
			continue
		}

		newPorts := make(map[uint16]bool)
		for _, port := range ports {
			if !ignoredPorts[port] {
				newPorts[port] = true
			}
		}

		// Detect additions
		for port := range newPorts {
			if !currentPorts[port] {
				fmt.Printf("LISTEN %d\n", port)
				os.Stdout.Sync()
			}
		}

		// Detect removals
		for port := range currentPorts {
			if !newPorts[port] {
				fmt.Printf("CLOSE %d\n", port)
				os.Stdout.Sync()
			}
		}

		currentPorts = newPorts
	}
}

func getListeningPorts() ([]uint16, error) {
	// Create netlink socket for SOCK_DIAG
	fd, err := unix.Socket(unix.AF_NETLINK, unix.SOCK_DGRAM, NETLINK_SOCK_DIAG)
	if err != nil {
		return nil, fmt.Errorf("socket: %w", err)
	}
	defer unix.Close(fd)

	// Bind to the socket
	addr := &unix.SockaddrNetlink{
		Family: unix.AF_NETLINK,
	}
	if err := unix.Bind(fd, addr); err != nil {
		return nil, fmt.Errorf("bind: %w", err)
	}

	var ports []uint16

	// Only query IPv4 - socat port forwarding listens on IPv6, so we skip it
	// User dev servers bind to 0.0.0.0 or 127.0.0.1 (IPv4)
	for _, family := range []uint8{unix.AF_INET} {
		p, err := queryFamily(fd, family)
		if err != nil {
			continue // Skip on error, try other family
		}
		ports = append(ports, p...)
	}

	// Deduplicate ports (same port might be on both IPv4 and IPv6)
	seen := make(map[uint16]bool)
	unique := make([]uint16, 0, len(ports))
	for _, port := range ports {
		if !seen[port] {
			seen[port] = true
			unique = append(unique, port)
		}
	}

	return unique, nil
}

func queryFamily(fd int, family uint8) ([]uint16, error) {
	// Build the request
	req := InetDiagReqV2{
		Family:   family,
		Protocol: unix.IPPROTO_TCP,
		States:   TCPF_LISTEN,
	}

	// Netlink message header
	nlh := unix.NlMsghdr{
		Len:   uint32(unix.NLMSG_HDRLEN + int(unsafe.Sizeof(req))),
		Type:  SOCK_DIAG_BY_FAMILY,
		Flags: unix.NLM_F_REQUEST | unix.NLM_F_DUMP,
		Seq:   1,
	}

	// Build the message
	msg := make([]byte, nlh.Len)
	*(*unix.NlMsghdr)(unsafe.Pointer(&msg[0])) = nlh
	*(*InetDiagReqV2)(unsafe.Pointer(&msg[unix.NLMSG_HDRLEN])) = req

	// Send the request
	destAddr := &unix.SockaddrNetlink{
		Family: unix.AF_NETLINK,
	}
	if err := unix.Sendto(fd, msg, 0, destAddr); err != nil {
		return nil, fmt.Errorf("sendto: %w", err)
	}

	// Receive responses
	var ports []uint16
	buf := make([]byte, 65536)

	for {
		n, _, err := unix.Recvfrom(fd, buf, 0)
		if err != nil {
			return nil, fmt.Errorf("recvfrom: %w", err)
		}

		// Parse netlink messages
		msgs, err := syscall.ParseNetlinkMessage(buf[:n])
		if err != nil {
			return nil, fmt.Errorf("parse: %w", err)
		}

		done := false
		for _, m := range msgs {
			if m.Header.Type == syscall.NLMSG_DONE {
				done = true
				break
			}
			if m.Header.Type == syscall.NLMSG_ERROR {
				// Check if it's an ACK (error code 0) or actual error
				if len(m.Data) >= 4 {
					errno := int32(binary.LittleEndian.Uint32(m.Data[:4]))
					if errno != 0 {
						return nil, fmt.Errorf("netlink error: %d", errno)
					}
				}
				continue
			}

			// Parse the InetDiagMsg
			if len(m.Data) >= int(unsafe.Sizeof(InetDiagMsg{})) {
				diagMsg := (*InetDiagMsg)(unsafe.Pointer(&m.Data[0]))
				// Sport is in network byte order (big endian)
				port := binary.BigEndian.Uint16(diagMsg.ID.Sport[:])
				ports = append(ports, port)
			}
		}

		if done {
			break
		}
	}

	return ports, nil
}
