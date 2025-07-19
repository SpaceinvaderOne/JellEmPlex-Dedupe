const express = require('express');
const fs = require('fs').promises;
const fse = require('fs-extra');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Serve static files
app.use(express.static('.'));

// Config directory path
const CONFIG_DIR = path.join(__dirname, 'serverconfig');

// Helper function to generate filename from server URL
const generateFileName = (serverUrl) => {
    // Remove protocol if present
    const cleanUrl = serverUrl.replace(/^https?:\/\//, '');
    // Replace any invalid filename characters
    const safeUrl = cleanUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `${safeUrl}.json`;
};

// Initialize config directories
const initializeConfigDirs = async () => {
    const serverTypes = ['plex', 'emby', 'jellyfin'];
    for (const serverType of serverTypes) {
        const dir = path.join(CONFIG_DIR, serverType);
        await fse.ensureDir(dir);
    }
};

// API endpoint to delete individual files (Plex filesystem deletion)
app.delete('/api/delete-file', async (req, res) => {
    try {
        const { filePath, serverUrl, apiKey } = req.body;
        
        console.log(`Attempting to delete file: ${filePath}`);
        
        if (!filePath) {
            return res.status(400).json({
                success: false,
                message: 'File path is required'
            });
        }
        
        // Check if file exists in container filesystem
        try {
            await fs.access(filePath);
            console.log(`File exists at: ${filePath}`);
        } catch (error) {
            console.log(`File not accessible: ${filePath}`);
            return res.status(404).json({
                success: false,
                message: 'Volume mapping required: Please map your media directories to enable Plex file deletion. Copy the same volume mappings from your Plex container.',
                details: `Could not access file at: ${filePath}`
            });
        }
        
        // Delete the file
        try {
            await fs.unlink(filePath);
            console.log(`Successfully deleted: ${filePath}`);
            
            // Trigger Plex library refresh if server details provided
            let refreshResult = null;
            if (serverUrl && apiKey) {
                refreshResult = await refreshPlexLibrary(serverUrl, apiKey);
            }
            
            return res.json({
                success: true,
                message: 'File deleted successfully',
                filePath: filePath,
                libraryRefresh: refreshResult
            });
            
        } catch (deleteError) {
            console.error(`Error deleting file: ${deleteError.message}`);
            return res.status(500).json({
                success: false,
                message: 'Failed to delete file',
                details: deleteError.message
            });
        }
        
    } catch (error) {
        console.error('Delete file API error:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            details: error.message
        });
    }
});

// Config management endpoints

// Get all configs for a server type
app.get('/api/configs/:serverType', async (req, res) => {
    try {
        const { serverType } = req.params;
        const configDir = path.join(CONFIG_DIR, serverType);
        
        console.log(`Getting configs for ${serverType} from ${configDir}`);
        
        // Check if directory exists
        if (!await fse.pathExists(configDir)) {
            return res.json([]);
        }
        
        const files = await fs.readdir(configDir);
        const configs = [];
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                const filePath = path.join(configDir, file);
                const config = await fse.readJson(filePath);
                configs.push({
                    filename: file,
                    displayName: config.serverUrl || file.replace('.json', ''),
                    ...config
                });
            }
        }
        
        res.json(configs);
    } catch (error) {
        console.error('Error getting configs:', error);
        res.status(500).json({ error: 'Failed to get configs' });
    }
});

// Save a config
app.post('/api/configs/:serverType', async (req, res) => {
    try {
        const { serverType } = req.params;
        const { serverUrl, apiKey } = req.body;
        
        console.log(`Saving config for ${serverType}: ${serverUrl}`);
        
        if (!serverUrl || !apiKey) {
            return res.status(400).json({ error: 'Server URL and API key are required' });
        }
        
        const configDir = path.join(CONFIG_DIR, serverType);
        await fse.ensureDir(configDir);
        
        const filename = generateFileName(serverUrl);
        const filePath = path.join(configDir, filename);
        
        const config = {
            serverType,
            serverUrl,
            apiKey,
            savedAt: new Date().toISOString()
        };
        
        await fse.writeJson(filePath, config, { spaces: 2 });
        
        res.json({ 
            message: 'Config saved successfully',
            filename,
            config 
        });
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).json({ error: 'Failed to save config' });
    }
});

// Delete a config
app.delete('/api/configs/:serverType/:filename', async (req, res) => {
    try {
        const { serverType, filename } = req.params;
        const filePath = path.join(CONFIG_DIR, serverType, filename);
        
        console.log(`Deleting config: ${filePath}`);
        
        if (!await fse.pathExists(filePath)) {
            return res.status(404).json({ error: 'Config not found' });
        }
        
        await fse.remove(filePath);
        res.json({ message: 'Config deleted successfully' });
    } catch (error) {
        console.error('Error deleting config:', error);
        res.status(500).json({ error: 'Failed to delete config' });
    }
});

// Function to refresh Plex library
async function refreshPlexLibrary(serverUrl, apiKey) {
    try {
        console.log('Triggering Plex library refresh...');
        
        // Normalize server URL
        let normalizedUrl = serverUrl;
        if (!/^https?:\/\//.test(normalizedUrl)) {
            normalizedUrl = 'http://' + normalizedUrl;
        }
        
        // Get all library sections
        const sectionsResponse = await fetch(`${normalizedUrl}/library/sections`, {
            headers: {
                'X-Plex-Token': apiKey,
                'Accept': 'application/json'
            }
        });
        
        if (!sectionsResponse.ok) {
            throw new Error(`Failed to get library sections: ${sectionsResponse.status}`);
        }
        
        const sectionsData = await sectionsResponse.json();
        const movieSections = sectionsData.MediaContainer.Directory.filter(section => section.type === 'movie');
        
        // Refresh each movie library
        const refreshPromises = movieSections.map(async (section) => {
            const refreshResponse = await fetch(`${normalizedUrl}/library/sections/${section.key}/refresh`, {
                method: 'POST',
                headers: {
                    'X-Plex-Token': apiKey,
                    'Accept': 'application/json'
                }
            });
            
            return {
                section: section.title,
                success: refreshResponse.ok,
                status: refreshResponse.status
            };
        });
        
        const refreshResults = await Promise.all(refreshPromises);
        console.log('Plex library refresh results:', refreshResults);
        
        return {
            success: true,
            results: refreshResults
        };
        
    } catch (error) {
        console.error('Error refreshing Plex library:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.send('healthy');
});

// Test endpoint to verify API proxy is working
app.get('/api/test', (req, res) => {
    console.log('API test endpoint called');
    res.json({ message: 'API proxy is working!', timestamp: new Date().toISOString() });
});

// Start server with error handling
const startServer = async () => {
    try {
        await initializeConfigDirs();
        app.listen(PORT, '0.0.0.0', (err) => {
            if (err) {
                console.error('Failed to start server:', err);
                process.exit(1);
            }
            console.log(`Media Server Duplicate Finder API running on port ${PORT}`);
            console.log(`Health check available at: http://localhost:${PORT}/health`);
            console.log(`Delete endpoint available at: http://localhost:${PORT}/api/delete-file`);
            console.log(`Config directory: ${CONFIG_DIR}`);
        }).on('error', (err) => {
            console.error('Server error:', err);
            process.exit(1);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();