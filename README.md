# JellEmPlex Dedupe

## Overview

JellEmPlex Dedupe is a web-based tool designed to help users identify and manage duplicate movies across Jellyfin, Emby, and Plex media servers. The tool identifies duplicates by comparing movie names and production years, then presents detailed information about file sizes, resolutions, codecs, and quality to help you make informed decisions about which copies to keep.

## Key Features

- **Multi-Server Support**: Works with Jellyfin, Emby, and Plex servers
- **Dark/Light Mode**: Toggle between themes for comfortable viewing
- **Configuration Management**: Save and load server configurations for quick access
- **Quality Detection**: Intelligent resolution and quality badge detection (4K, 1080p, 720p, etc.)
- **Codec Information**: Display video (H.264, HEVC, etc.) and audio codec details
- **Direct Deletion**: Remove unwanted duplicates directly through the web interface
- **Export Functionality**: Download duplicate lists as text files for offline review
- **Responsive Design**: Works on desktop and mobile devices
- **Local/Remote Support**: Connect to servers via IP addresses or domain names

## Installation

### Unraid (Recommended)

The easiest way to install JellEmPlex Dedupe on Unraid is through Community Applications:

1. Open **Community Applications** in your Unraid interface
2. Search for **"JellEmPlex Dedupe"**
3. Click **Install** - no configuration required, all defaults work perfectly
4. Access the tool via webUI from the docker tab

The template is pre-configured and ready to use - simply install and go!

### Getting API Keys

#### Jellyfin & Emby
1. Log into your server's web interface
2. Go to **Settings/Administration** → **API Keys** 
3. Click **"Generate API Key"** or **"New API Key"**
4. Give it a name (e.g., "JellEmPlex Dedupe") and save
5. Copy the generated key

#### Plex
For Plex, you need to extract the token from your server's configuration:

**On Unraid:**
1. Navigate to your **appdata share**: `/mnt/user/appdata/plex/Library/Application Support/Plex Media Server/`
2. Open the **`Preferences.xml`** file
3. Look for the `PlexOnlineToken` field
4. Copy the token value (example: `PlexOnlineToken="lB2sZ2qttaoC6_73zCLg"`)

**On other systems:**
- Windows: `%LOCALAPPDATA%/Plex Media Server/Preferences.xml`
- macOS: `~/Library/Application Support/Plex Media Server/Preferences.xml`
- Linux: `/var/lib/plexmediaserver/Library/Application Support/Plex Media Server/Preferences.xml`

## Usage

1. **Select Server Type**: Choose Jellyfin, Emby, or Plex from the dropdown
2. **Enter Server URL**: Use either:
   - Local IP: `192.168.1.100:8096`
   - Remote domain: `https://jellyfin.yourdomain.com`
3. **Add API Key**: Paste your server's API key or Plex token
4. **Save Configuration** (optional): Check the box to save these settings for future use
5. **Find Duplicates**: Click "Find Duplicate Movies" to scan your libraries
6. **Review Results**: Examine duplicates with quality, codec, and file size information
7. **Delete Unwanted Files**: Click delete buttons to remove lower quality duplicates

## Docker Installation (Other Systems)

### Docker Run
```bash
docker run -d \
  --name jellemplex-dedupe \
  -p 8080:80 \
  spaceinvaderone/jellemplex-dedupe:latest
```

### Docker Compose
```yaml
version: '3.8'
services:
  jellemplex-dedupe:
    image: spaceinvaderone/jellemplex-dedupe:latest
    container_name: jellemplex-dedupe
    ports:
      - "3369:80"
    restart: unless-stopped
```

## Configuration Management

The tool can save your server configurations locally for convenience:

- **Saved Configurations**: Stored by server type and connection details
- **Quick Access**: Load previously saved configurations with one click
- **Multiple Configs**: Save different configurations for different servers
- **Security**: Configurations are stored locally on your machine only

## Quality Detection

JellEmPlex Dedupe features intelligent quality detection:

- **Resolution-Based**: Automatically detects 4K, 1080p, 720p, SD content
- **Aspect Ratio Aware**: Distinguishes between standard, scope, and flat formats
- **User-Friendly Labels**: Shows "1080p Scope" instead of technical "816p"
- **Quality Badges**: Color-coded badges for easy quality comparison

## Contributing

This project is open source and welcomes contributions! Visit the GitHub repository to:
- Report bugs or request features
- Submit pull requests
- Fork the project for your own modifications

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
