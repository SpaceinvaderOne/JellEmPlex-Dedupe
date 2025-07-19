async function findDuplicates() {
    const serverType = document.getElementById('serverType').value;
    let serverUrl = document.getElementById('serverUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value;
    const resultsDiv = document.getElementById('results');
    const loadingOverlay = document.getElementById('loading-overlay');

    resultsDiv.innerHTML = '';
    loadingOverlay.classList.remove('hidden');

    if (!/^https?:\/\//i.test(serverUrl)) {
        serverUrl = 'http://' + serverUrl;
    }

    // Save config if checkbox is checked
    await saveConfigIfChecked();

    try {
        const libraries = await fetchLibraries(serverUrl, apiKey, serverType);
        const movieLibraries = libraries.filter(lib => lib.CollectionType === 'movies');
        const duplicateResults = [];

        for (const library of movieLibraries) {
            const movies = await fetchMoviesFromLibrary(serverUrl, apiKey, library.ItemId, serverType);
            let duplicates = {};
            try {
                if (serverType === 'plex') {
                    duplicates = findPlexDuplicates(movies);
                } else {
                    duplicates = findDuplicatesInLibrary(movies);
                }
            } catch (error) {
                console.error('Error in findDuplicatesInLibrary:', error);
            }
            if (Object.keys(duplicates).length > 0) {
                duplicateResults.push({
                    libraryName: library.Name,
                    duplicates: duplicates,
                    count: Object.keys(duplicates).length
                });
            }
        }

        displayResults(duplicateResults);
    } catch (error) {
        resultsDiv.innerHTML = `<p>Error: ${error.message}</p>`;
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

async function fetchLibraries(serverUrl, apiKey, serverType) {
    if (serverType === 'plex') {
        return await fetchPlexLibraries(serverUrl, apiKey);
    }
    
    const endpoint = serverType === 'jellyfin' ? '/Library/VirtualFolders' : '/emby/Library/VirtualFolders';
    const response = await fetch(`${serverUrl}${endpoint}?api_key=${apiKey}`);
    if (!response.ok) throw new Error('Failed to fetch libraries');
    return await response.json();
}

async function fetchMoviesFromLibrary(serverUrl, apiKey, libraryId, serverType) {
    if (serverType === 'plex') {
        return await fetchPlexMoviesFromLibrary(serverUrl, apiKey, libraryId);
    }
    
    const endpoint = serverType === 'jellyfin' ? '/Items' : '/emby/Items';
    const response = await fetch(`${serverUrl}${endpoint}?Recursive=true&ParentId=${libraryId}&IncludeItemTypes=Movie&Fields=Path,ProductionYear,RunTimeTicks,MediaSources,MediaStreams&api_key=${apiKey}`);
    if (!response.ok) throw new Error(`Failed to fetch movies from library ${libraryId}`);
    const data = await response.json();
    return data.Items || [];
}

// Plex-specific API functions
async function fetchPlexLibraries(serverUrl, plexToken) {
    const response = await fetch(`${serverUrl}/library/sections`, {
        headers: {
            'X-Plex-Token': plexToken,
            'Accept': 'application/json'
        }
    });
    if (!response.ok) throw new Error('Failed to fetch Plex libraries');
    const data = await response.json();
    
    // Map Plex sections to Emby/Jellyfin structure
    const directories = data.MediaContainer.Directory || [];
    console.log('Plex directories:', directories);
    return directories.map(section => {
        const mapped = {
            Name: section.title,
            ItemId: section.key,
            CollectionType: section.type === 'movie' ? 'movies' : section.type
        };
        console.log('Mapped section:', mapped);
        return mapped;
    });
}

async function fetchPlexMoviesFromLibrary(serverUrl, plexToken, sectionKey) {
    const response = await fetch(`${serverUrl}/library/sections/${sectionKey}/all?type=1`, {
        headers: {
            'X-Plex-Token': plexToken,
            'Accept': 'application/json'
        }
    });
    if (!response.ok) throw new Error(`Failed to fetch Plex movies from library ${sectionKey}`);
    const data = await response.json();
    
    // Map Plex metadata to Emby/Jellyfin structure
    const metadata = data.MediaContainer.Metadata || [];
    const movies = [];
    
    // For each movie, get detailed metadata including streams
    for (const movie of metadata) {
        try {
            const detailResponse = await fetch(`${serverUrl}/library/metadata/${movie.ratingKey}`, {
                headers: {
                    'X-Plex-Token': plexToken,
                    'Accept': 'application/json'
                }
            });
            
            if (detailResponse.ok) {
                const detailData = await detailResponse.json();
                const detailedMovie = detailData.MediaContainer.Metadata && detailData.MediaContainer.Metadata[0];
                
                if (detailedMovie) {
                    const firstMedia = detailedMovie.Media && detailedMovie.Media[0];
                    const firstPart = firstMedia && firstMedia.Part && firstMedia.Part[0];
                    
                    // Collect all streams from all parts of all media
                    const allStreams = [];
                    if (detailedMovie.Media) {
                        detailedMovie.Media.forEach(media => {
                            if (media.Part) {
                                media.Part.forEach(part => {
                                    if (part.Stream) {
                                        allStreams.push(...part.Stream);
                                    }
                                });
                            }
                        });
                    }
                    
                    movies.push({
                        Name: detailedMovie.title || 'Unknown',
                        Id: detailedMovie.ratingKey,
                        Path: firstPart ? firstPart.file : 'Unknown',
                        ProductionYear: detailedMovie.year,
                        MediaSources: detailedMovie.Media ? detailedMovie.Media.map(media => {
                            const part = media.Part && media.Part[0];
                            return {
                                mediaId: media.id, // Add Media ID for deletion
                                Size: part ? part.size || 0 : 0,
                                Part: media.Part, // Include the full Part array
                                width: media.width,
                                height: media.height,
                                videoResolution: media.videoResolution,
                                file: part ? part.file : 'Unknown' // Add file path to MediaSource
                            };
                        }) : [],
                        MediaStreams: allStreams.map(stream => ({
                            Type: stream.streamType === 1 ? 'Video' : stream.streamType === 2 ? 'Audio' : 'Subtitle',
                            Width: stream.width,
                            Height: stream.height,
                            Codec: stream.codec || 'Unknown',
                            Language: stream.language || stream.languageTag || 'Unknown',
                            ChannelLayout: stream.audioChannelLayout || stream.channels || 'Unknown',
                            DisplayTitle: stream.displayTitle || stream.extendedDisplayTitle || 'Unknown'
                        }))
                    });
                    continue;
                }
            }
        } catch (error) {
            console.warn(`Failed to fetch detailed metadata for movie ${movie.ratingKey}:`, error);
        }
        
        // Fallback to basic movie data if detailed fetch fails
        const firstMedia = movie.Media && movie.Media[0];
        const firstPart = firstMedia && firstMedia.Part && firstMedia.Part[0];
        
        movies.push({
            Name: movie.title || 'Unknown',
            Id: movie.ratingKey,
            Path: firstPart ? firstPart.file : 'Unknown',
            ProductionYear: movie.year,
            MediaSources: movie.Media ? movie.Media.map(media => {
                const part = media.Part && media.Part[0];
                return {
                    Size: part ? part.size || 0 : 0,
                    Part: media.Part, // Include the full Part array
                    width: media.width,
                    height: media.height,
                    videoResolution: media.videoResolution,
                    file: part ? part.file : 'Unknown' // Add file path to MediaSource
                };
            }) : [],
            MediaStreams: [] // No streams available in basic data
        });
    }
    
    return movies;
}

// Plex-specific duplicate detection (looks for movies with multiple MediaSources)
function findPlexDuplicates(movies) {
    const duplicates = {};
    
    movies.forEach((movie, index) => {
        
        // Check if this movie has multiple MediaSources (Plex's way of handling duplicates)
        if (movie.MediaSources && movie.MediaSources.length > 1) {
            
            const key = `${movie.Name.trim()}_${movie.ProductionYear || 'unknown'}`;
            
            // Create fake "duplicate" entries for each MediaSource to match the expected format
            duplicates[key] = movie.MediaSources.map((mediaSource, sourceIndex) => {
                // Get file path from MediaSource - try different possible structures
                let path = 'Unknown';
                if (mediaSource.file) {
                    path = mediaSource.file;
                } else if (mediaSource.Part && mediaSource.Part.length > 0) {
                    const part = mediaSource.Part[0];
                    console.log(`Part structure:`, part);
                    path = part.file || 'Unknown';
                } else if (movie.Path) {
                    // Fallback to movie-level path
                    path = movie.Path;
                }
                
                // Get file size
                let size = 0;
                if (mediaSource.size) {
                    size = mediaSource.size;
                } else if (mediaSource.Part && mediaSource.Part.length > 0 && mediaSource.Part[0].size) {
                    size = mediaSource.Part[0].size;
                } else if (mediaSource.Size) {
                    size = mediaSource.Size;
                }
                
                // Get resolution and codec from MediaSource
                let resolution = 'Unknown';
                let codec = 'Unknown';
                if (mediaSource.width && mediaSource.height) {
                    resolution = `${mediaSource.width}x${mediaSource.height}`;
                } else if (mediaSource.videoResolution) {
                    resolution = mediaSource.videoResolution;
                }
                
                // Get codec from the movie's MediaStreams (already properly extracted)
                let audioCodec = 'Unknown';
                if (movie.MediaStreams && movie.MediaStreams.length > 0) {
                    const videoStream = movie.MediaStreams.find(stream => stream.Type === 'Video');
                    const audioStream = movie.MediaStreams.find(stream => stream.Type === 'Audio');
                    
                    if (videoStream) {
                        codec = videoStream.Codec || 'Unknown';
                        
                        // Also get resolution from MediaStreams if not available from MediaSource
                        if (resolution === 'Unknown' && videoStream.Width && videoStream.Height) {
                            resolution = `${videoStream.Width}x${videoStream.Height}`;
                        }
                    }
                    
                    if (audioStream) {
                        audioCodec = formatAudioInfo(audioStream);
                    }
                }
                
                // Fallback: Try to get codec from Part or Media level
                if (codec === 'Unknown' && mediaSource.Part && mediaSource.Part.length > 0) {
                    const part = mediaSource.Part[0];
                    
                    // If there's a Stream array, try that first for actual codec names
                    if (part.Stream && part.Stream.length > 0) {
                        const videoStream = part.Stream.find(stream => stream.streamType === 1);
                        if (videoStream) {
                            if (videoStream.width && videoStream.height && resolution === 'Unknown') {
                                resolution = `${videoStream.width}x${videoStream.height}`;
                            }
                            codec = videoStream.codec || videoStream.videoCodec || videoStream.displayTitle || 'Unknown';
                        }
                    }
                    
                    // If still no codec, try to get it from Media level (go back to parent Media object)
                    if (codec === 'Unknown') {
                        // The mediaSource should have the original Media data
                        if (mediaSource.videoCodec) {
                            codec = mediaSource.videoCodec;
                        } else if (mediaSource.codec) {
                            codec = mediaSource.codec;
                        }
                    }
                    
                    // Last resort: use container format
                    if (codec === 'Unknown' && part.container) {
                        codec = part.container.toUpperCase();
                    }
                }
                
                // Try to get MediaPart ID for individual file deletion
                let mediaPartId = null;
                if (mediaSource.Part && mediaSource.Part.length > 0) {
                    const part = mediaSource.Part[0];
                    if (part.id) {
                        mediaPartId = part.id;
                    } else if (part.key) {
                        // Extract ID from key if available
                        const keyMatch = part.key.match(/\/parts\/(\d+)/);
                        if (keyMatch) {
                            mediaPartId = keyMatch[1];
                        }
                    }
                }
                
                const result = {
                    path: path,
                    year: movie.ProductionYear,
                    size: size,
                    resolution: resolution,
                    codec: codec,
                    audioCodec: audioCodec,
                    originalName: movie.Name.trim(),
                    itemId: movie.Id,
                    effectiveYear: movie.ProductionYear,
                    exactKey: key,
                    mediaSourceIndex: sourceIndex,
                    mediaPartId: mediaPartId, // Add MediaPart ID for individual deletion
                    mediaId: mediaSource.mediaId // Add Media ID for deletion
                };
                return result;
            });
            
        }
    });
    
    return duplicates;
}

// Utility function to format audio information
function formatAudioInfo(audioStream) {
    if (!audioStream) return 'Unknown';
    
    const parts = [];
    
    // Add language
    let language = 'Unknown';
    if (audioStream.Language && audioStream.Language !== 'Unknown') {
        language = audioStream.Language;
    } else if (audioStream.DisplayTitle && audioStream.DisplayTitle.includes('(')) {
        // Try to extract language from DisplayTitle like "English (AAC Stereo)"
        const langMatch = audioStream.DisplayTitle.match(/^([^(]+)/);
        if (langMatch) {
            language = langMatch[1].trim();
        }
    }
    
    // Add codec
    let codec = 'Unknown';
    if (audioStream.Codec && audioStream.Codec !== 'Unknown') {
        codec = audioStream.Codec.toUpperCase();
    }
    
    // Add channel layout
    let channels = '';
    if (audioStream.ChannelLayout && audioStream.ChannelLayout !== 'Unknown') {
        channels = audioStream.ChannelLayout;
    } else if (audioStream.DisplayTitle) {
        // Try to extract channel info from DisplayTitle
        const channelMatch = audioStream.DisplayTitle.match(/\b(stereo|mono|5\.1|7\.1|2\.0|5\.0|7\.0)\b/i);
        if (channelMatch) {
            channels = channelMatch[1];
        }
    }
    
    // Build the display string
    if (language !== 'Unknown') parts.push(language);
    if (codec !== 'Unknown') parts.push(codec);
    if (channels) parts.push(channels);
    
    return parts.length > 0 ? parts.join(' ') : 'Unknown';
}

// Utility functions for improved duplicate detection
function calculateSimilarity(str1, str2) {
    // Simple Levenshtein distance-based similarity
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

function findDuplicatesInLibrary(movies) {
    console.log('=== STARTING DUPLICATE DETECTION ===');
    console.log('Number of movies to process:', movies.length);
    console.log('First movie sample:', movies[0]);
    const duplicates = {};

    movies.forEach((movie, index) => {
        console.log(`Processing movie ${index + 1}:`, movie);
        const name = movie.Name;
        const year = movie.ProductionYear;
        const path = movie.Path;
        console.log(`Movie details - Name: "${name}", Year: ${year}, Path: "${path}"`);
        
        // Get file size from MediaSources
        let fileSize = 0;
        if (movie.MediaSources && movie.MediaSources.length > 0) {
            fileSize = movie.MediaSources[0].Size || 0;
        }

        // Get resolution and codec from MediaStreams
        let resolution = 'Unknown';
        let codec = 'Unknown';
        let audioCodec = 'Unknown';
        if (movie.MediaStreams && movie.MediaStreams.length > 0) {
            const videoStream = movie.MediaStreams.find(stream => stream.Type === 'Video');
            if (videoStream) {
                if (videoStream.Width && videoStream.Height) {
                    resolution = `${videoStream.Width}x${videoStream.Height}`;
                }
                codec = videoStream.Codec || videoStream.VideoCodec || 'Unknown';
            }
            
            const audioStream = movie.MediaStreams.find(stream => stream.Type === 'Audio');
            if (audioStream) {
                audioCodec = formatAudioInfo(audioStream);
            }
        }

        if (!name) {
            console.log(`Skipping movie ${index + 1} - no name`);
            return;
        }

        // Extract year from path if available (more reliable than metadata for remakes)
        let pathYear = null;
        if (path) {
            // Look for year in various formats in the path
            const pathYearMatch = path.match(/[\\/\(\[\s](\d{4})[\)\]\s\.\-_]/);
            if (pathYearMatch) {
                pathYear = parseInt(pathYearMatch[1]);
            }
        }

        // Use path year if it exists and differs from metadata year, otherwise use metadata year
        const effectiveYear = (pathYear && pathYear !== year && pathYear >= 1900 && pathYear <= new Date().getFullYear()) ? pathYear : year;

        // Clean the movie name but be more conservative
        const cleanName = name.trim()
            .replace(/\s*\(\d{4}\)\s*/g, '') // Remove year in parentheses
            .replace(/\b(1080p|720p|4k|uhd|hdr|x264|x265|hevc|bluray|blu-ray|webrip|web-dl|brrip)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Create a more specific key using EXACT name match + year
        // This prevents different movies from being grouped together
        const exactKey = `${name.trim()}_${effectiveYear || 'unknown'}`;
        console.log(`Generated exactKey: "${exactKey}"`);
        
        if (!duplicates[exactKey]) duplicates[exactKey] = [];
        duplicates[exactKey].push({ 
            path, 
            year, 
            size: fileSize, 
            resolution,
            codec,
            audioCodec,
            originalName: name.trim(),
            itemId: movie.Id,
            effectiveYear: effectiveYear,
            exactKey: exactKey
        });
        console.log(`Current duplicates for key "${exactKey}":`, duplicates[exactKey]);
    });

    console.log('All duplicate groups before filtering:', duplicates);
    
    // Only return groups that have multiple movies with IDENTICAL names and years
    const finalDuplicates = {};
    for (const [key, movies] of Object.entries(duplicates)) {
        console.log(`Checking group "${key}" with ${movies.length} movies`);
        if (movies.length > 1) {
            // Additional validation: ensure these are truly identical
            const firstMovie = movies[0];
            const allIdentical = movies.every(movie => 
                movie.originalName === firstMovie.originalName && 
                movie.effectiveYear === firstMovie.effectiveYear
            );
            
            if (allIdentical) {
                console.log(`Group "${key}" identified as duplicates:`, movies);
                finalDuplicates[key] = movies;
            } else {
                console.log(`Group "${key}" rejected - not all identical`);
            }
        } else {
            console.log(`Group "${key}" has only ${movies.length} movie(s) - not duplicates`);
        }
    }

    console.log('Final duplicates result:', finalDuplicates);
    return finalDuplicates;
}

function normalizeMovieName(name) {
    // Remove common edition/version indicators that don't change the core movie identity
    let normalized = name
        // Remove year in parentheses at the end
        .replace(/\s*\(\d{4}\)\s*$/g, '')
        // Remove edition types (case insensitive)
        .replace(/\b(director'?s? cut|extended|unrated|theatrical|ultimate|special|remastered|redux|final cut|criterion|collector'?s?)\b/gi, '')
        // Remove quality indicators
        .replace(/\b(1080p|720p|4k|uhd|hdr|dts|ac3|x264|x265|hevc|bluray|blu-ray|dvdrip|webrip|web-dl|brrip|hdtv)\b/gi, '')
        // Remove codec and container info
        .replace(/\b(mkv|mp4|avi|mov|wmv|flv|m4v|divx|xvid)\b/gi, '')
        // Remove audio channel info
        .replace(/\b(5\.1|7\.1|2\.0|stereo|mono)\b/gi, '')
        // Remove release group tags (usually in brackets or at the end)
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\{[^}]*\}/g, '')
        // Remove parentheses content that might contain quality info, but preserve important story info
        .replace(/\([^)]*(?:1080p|720p|4k|uhd|hdr|dts|ac3|x264|x265|hevc|bluray|blu-ray|dvdrip|webrip|web-dl|brrip|hdtv|mkv|mp4|avi)[^)]*\)/gi, '')
        // Remove common release tags
        .replace(/\b(remux|internal|proper|repack|read\.nfo|nfo)\b/gi, '')
        // Clean up multiple spaces and trim
        .replace(/\s+/g, ' ')
        .trim();
    
    return normalized;
}

function filterOutSequels(movies) {
    // Since we're now using exact name + year matching, 
    // this function is much simpler - just return all movies
    // as they should already be true duplicates
    return movies;
}

function displayResults(duplicateResults) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    if (duplicateResults.length === 0) {
        resultsDiv.innerHTML = '<p>No duplicates found in any library.</p>';
        return;
    }

    duplicateResults.forEach((result, index) => {
        const libraryBox = document.createElement('div');
        libraryBox.className = 'library-box';
        libraryBox.style.animationDelay = `${index * 0.1}s`;
        libraryBox.innerHTML = `
            <h3>${result.libraryName}</h3>
            <p>Total duplicate movies: ${result.count}</p>
            <button onclick="showDuplicatesHTML('${result.libraryName}', ${JSON.stringify(result.duplicates).replace(/"/g, '&quot;')})">View Details</button>
            <button onclick="downloadDuplicates('${result.libraryName}', ${JSON.stringify(result.duplicates).replace(/"/g, '&quot;')})">Download List</button>
        `;
        resultsDiv.appendChild(libraryBox);
    });
}

function downloadDuplicates(libraryName, duplicates) {
    let content = `Duplicates in library: ${libraryName}\n`;
    content += `${'='.repeat(100)}\n\n`;
    
    for (const [key, paths] of Object.entries(duplicates)) {
        content += `Duplicate Set: ${key}\n`;
        content += `${'-'.repeat(80)}\n`;
        
        // Create table header
        content += `${'Movie Title'.padEnd(50)} | ${'Year'.padEnd(6)} | ${'Size'.padEnd(10)} | ${'Resolution'.padEnd(12)} | ${'Video'.padEnd(8)} | ${'Audio'.padEnd(20)} | Full Path\n`;
        content += `${'-'.repeat(50)} | ${'-'.repeat(6)} | ${'-'.repeat(10)} | ${'-'.repeat(12)} | ${'-'.repeat(8)} | ${'-'.repeat(20)} | ${'-'.repeat(80)}\n`;
        
        // Add each duplicate file
        paths.forEach(({ path, year, size, resolution, codec, audioCodec, originalName, itemId }) => {
            const formattedSize = formatFileSize(size);
            const movieTitle = originalName || 'Unknown';
            const displayTitle = movieTitle.length > 47 ? movieTitle.substring(0, 44) + '...' : movieTitle;
            const displayYear = year ? year.toString() : 'N/A';
            const codecDisplay = codec && codec !== 'Unknown' ? codec.toUpperCase() : 'Unknown';
            const audioCodecDisplay = audioCodec && audioCodec !== 'Unknown' ? audioCodec : 'Unknown';
            
            content += `${displayTitle.padEnd(50)} | ${displayYear.padEnd(6)} | ${formattedSize.padEnd(10)} | ${resolution.padEnd(12)} | ${codecDisplay.padEnd(8)} | ${audioCodecDisplay.padEnd(20)} | ${path}\n`;
        });
        
        content += '\n';
    }
    
    // Add summary
    const totalDuplicates = Object.keys(duplicates).length;
    const totalFiles = Object.values(duplicates).reduce((sum, paths) => sum + paths.length, 0);
    content += `${'='.repeat(100)}\n`;
    content += `Summary: ${totalDuplicates} duplicate sets found with ${totalFiles} total files\n`;
    content += `${'='.repeat(100)}\n`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${libraryName}_duplicates.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Function to determine quality using cost-based classification
function getQualityByNearestResolution(width, height) {
    // Pre-normalize for non-square pixels (common in older DV/DVD formats)
    const normalizedWidth = width;
    const normalizedHeight = height;
    
    // Handle vertical video by swapping axes
    let w = normalizedWidth;
    let h = normalizedHeight;
    if (h > w) {
        [w, h] = [h, w];
    }
    
    // Generate all canonical resolutions including dynamic K-bins
    const canonicalResolutions = [];
    
    // Standard resolutions with proper aspect ratios
    const standardResolutions = [
        // 16:9 resolutions
        { width: 7680, height: 4320, format: '8K', color: '#8e44ad' },
        { width: 3840, height: 2160, format: '4K', color: '#e74c3c' },
        { width: 2560, height: 1440, format: '1440p', color: '#2ecc71' },
        { width: 1920, height: 1080, format: '1080p', color: '#27ae60' },
        { width: 1280, height: 720, format: '720p', color: '#f39c12' },
        { width: 854, height: 480, format: '480p', color: '#3498db' },
        { width: 640, height: 360, format: '360p', color: '#9b59b6' },
        { width: 426, height: 240, format: '240p', color: '#95a5a6' },
        
        // 4:3 resolutions
        { width: 2048, height: 1536, format: '1536p (4:3)', color: '#2ecc71' },
        { width: 1920, height: 1440, format: '1440p (4:3)', color: '#27ae60' },
        { width: 1440, height: 1080, format: '1080p (4:3)', color: '#27ae60' },
        { width: 1280, height: 960, format: '960p (4:3)', color: '#f39c12' },
        { width: 1024, height: 768, format: 'XGA (4:3)', color: '#3498db' },
        { width: 800, height: 600, format: 'SVGA (4:3)', color: '#9b59b6' },
        { width: 640, height: 480, format: 'VGA (4:3)', color: '#95a5a6' },
        
        // 16:10 resolutions
        { width: 2560, height: 1600, format: '1600p (16:10)', color: '#2ecc71' },
        { width: 1920, height: 1200, format: '1200p (16:10)', color: '#27ae60' },
        { width: 1680, height: 1050, format: '1050p (16:10)', color: '#f39c12' },
        { width: 1440, height: 900, format: '900p (16:10)', color: '#3498db' },
        { width: 1280, height: 800, format: '800p (16:10)', color: '#9b59b6' },
        
        // Scope/Cinemascope resolutions
        { width: 4096, height: 1716, format: '4K Scope', color: '#8e44ad' },
        { width: 2048, height: 858, format: '2K Scope', color: '#e74c3c' },
        { width: 1920, height: 800, format: '1080p Scope', color: '#27ae60' },
        { width: 1280, height: 536, format: '720p Scope', color: '#f39c12' }
    ];
    
    // Add DCI resolutions with strict enforcement
    const dciResolutions = [
        { width: 4096, height: 2160, format: '4K DCI', color: '#8e44ad' },
        { width: 2048, height: 1080, format: '2K DCI', color: '#e74c3c' }
    ];
    
    // Add all standard resolutions
    canonicalResolutions.push(...standardResolutions);
    
    // Add DCI resolutions only if width is in strict ranges
    if (w >= 3996 && w <= 4100) {
        canonicalResolutions.push(dciResolutions[0]);
    }
    if (w >= 1998 && w <= 2050) {
        canonicalResolutions.push(dciResolutions[1]);
    }
    
    // Dynamic K-bin generation for modern resolutions
    const kBins = [];
    for (let k = 2.5; k <= 10; k += 0.5) {
        const kWidth = Math.round(k * 1000);
        // Generate 16:9 equivalent for each K-bin
        const kHeight = Math.round(kWidth * 9 / 16);
        kBins.push({
            width: kWidth,
            height: kHeight,
            format: `${k}K`,
            color: k >= 8 ? '#8e44ad' : k >= 4 ? '#e74c3c' : '#2ecc71'
        });
    }
    canonicalResolutions.push(...kBins);
    
    // Find best match using single cost function
    let bestMatch = null;
    let lowestCost = Infinity;
    
    for (const canonical of canonicalResolutions) {
        const w0 = canonical.width;
        const h0 = canonical.height;
        
        // Normalized pixel error
        const pixelError = (Math.abs(w - w0) + Math.abs(h - h0)) / (w0 + h0);
        
        // Aspect ratio error
        const aspectRatio = w / h;
        const canonicalAspectRatio = w0 / h0;
        const aspectError = Math.abs(aspectRatio - canonicalAspectRatio) / canonicalAspectRatio;
        
        // Combined cost function (80% pixel, 20% aspect ratio)
        const cost = 0.8 * pixelError + 0.2 * aspectError;
        
        if (cost < lowestCost) {
            lowestCost = cost;
            bestMatch = canonical;
        }
    }
    
    // Map to familiar quality buckets for user-friendly display
    const actualHeight = Math.min(w, h) === h ? h : w; // Get the actual height
    const aspectRatio = w / h;
    
    // Define familiar quality buckets with tolerance ranges
    let qualityLabel = '';
    let qualityColor = bestMatch.color;
    
    // For scope content (letterboxed), determine base resolution from width
    if (aspectRatio >= 2.3) {
        // Width-based mapping for scope content
        if (w >= 3456) { // 4K scope width range
            qualityLabel = '4K';
            qualityColor = '#e74c3c';
        } else if (w >= 1728) { // 1080p scope width range
            qualityLabel = '1080p';
            qualityColor = '#27ae60';
        } else if (w >= 1152) { // 720p scope width range
            qualityLabel = '720p';
            qualityColor = '#f39c12';
        } else {
            qualityLabel = 'SD';
            qualityColor = '#95a5a6';
        }
        qualityLabel += ' Scope';
    } else {
        // Height-based mapping for standard content with ±10% tolerance
        if (actualHeight < 480) {
            qualityLabel = 'SD';
            qualityColor = '#95a5a6';
        } else if (actualHeight >= 648 && actualHeight <= 792) { // 720p ±10%
            qualityLabel = '720p';
            qualityColor = '#f39c12';
        } else if (actualHeight >= 972 && actualHeight <= 1188) { // 1080p ±10%
            qualityLabel = '1080p';
            qualityColor = '#27ae60';
        } else if (actualHeight >= 1296 && actualHeight <= 1584) { // 1440p ±10%
            qualityLabel = '1440p';
            qualityColor = '#2ecc71';
        } else if (actualHeight >= 1944 && actualHeight <= 2376) { // 2160p (4K) ±10%
            qualityLabel = '4K';
            qualityColor = '#e74c3c';
        } else if (actualHeight >= 3888 && actualHeight <= 4752) { // 4320p (8K) ±10%
            qualityLabel = '8K';
            qualityColor = '#8e44ad';
        } else {
            // For heights that don't fit familiar buckets, try width-based mapping for letterboxed content
            if (w >= 3456) { // 4K width range
                qualityLabel = '4K';
                qualityColor = '#e74c3c';
            } else if (w >= 2304) { // 1440p width range
                qualityLabel = '1440p';
                qualityColor = '#2ecc71';
            } else if (w >= 1728) { // 1080p width range  
                qualityLabel = '1080p';
                qualityColor = '#27ae60';
            } else if (w >= 1152) { // 720p width range
                qualityLabel = '720p';
                qualityColor = '#f39c12';
            } else if (w >= 3500) {
                // For very high resolutions, use K designation
                const kValue = Math.round(w / 1000 * 2) / 2; // Round to nearest 0.5K
                qualityLabel = `${kValue}K`;
                qualityColor = kValue >= 8 ? '#8e44ad' : kValue >= 4 ? '#e74c3c' : '#2ecc71';
            } else {
                // Fall back to actual height for very unusual resolutions
                qualityLabel = `${actualHeight}p`;
                qualityColor = '#3498db';
            }
        }
        
        // Add "Flat" qualifier for letterboxed content (not standard aspect ratios)
        if (aspectRatio >= 1.85 && aspectRatio < 2.3) {
            // Check if it's NOT a standard ratio (16:9, 4:3, 16:10)
            const isStandard16x9 = Math.abs(aspectRatio - 1.78) < 0.05;
            const isStandard4x3 = Math.abs(aspectRatio - 1.33) < 0.05;
            const isStandard16x10 = Math.abs(aspectRatio - 1.60) < 0.05;
            
            if (!isStandard16x9 && !isStandard4x3 && !isStandard16x10) {
                qualityLabel += ' Flat';
            }
        }
    }
    // Standard ratios (16:9, 4:3, 16:10) get no qualifier for cleaner display
    
    return {
        quality: qualityLabel,
        color: qualityColor
    };
}

function setDefaultValues() {
    const serverTypeSelect = document.getElementById('serverType');
    const serverUrlInput = document.getElementById('serverUrl');
    const apiKeyInput = document.getElementById('apiKey');
    
    // Load from localStorage only
    const savedServerType = localStorage.getItem('serverType') || 'emby';
    const savedUrl = localStorage.getItem('serverUrl');
    const savedApiKey = localStorage.getItem('apiKey');
    
    if (serverTypeSelect) {
        serverTypeSelect.value = savedServerType;
        
        // Save to localStorage when value changes and update UI
        serverTypeSelect.addEventListener('change', () => {
            localStorage.setItem('serverType', serverTypeSelect.value);
            updatePlaceholderForServerType(serverTypeSelect.value);
            updateTheme(serverTypeSelect.value);
        });
        
        // Set initial placeholder and theme
        updatePlaceholderForServerType(savedServerType);
        updateTheme(savedServerType);
    }
    
    if (serverUrlInput) {
        if (savedUrl) {
            serverUrlInput.value = savedUrl;
        }
        
        // Save to localStorage when value changes
        serverUrlInput.addEventListener('blur', () => {
            if (serverUrlInput.value.trim()) {
                localStorage.setItem('serverUrl', serverUrlInput.value.trim());
            }
        });
    }
    
    if (apiKeyInput) {
        if (savedApiKey) {
            apiKeyInput.value = savedApiKey;
        }
        
        // Save to localStorage when value changes
        apiKeyInput.addEventListener('blur', () => {
            if (apiKeyInput.value.trim()) {
                localStorage.setItem('apiKey', apiKeyInput.value.trim());
            }
        });
    }
}

// Update placeholder text based on server type
function updatePlaceholderForServerType(serverType) {
    const apiKeyInput = document.getElementById('apiKey');
    const serverUrlInput = document.getElementById('serverUrl');
    
    if (apiKeyInput) {
        if (serverType === 'plex') {
            apiKeyInput.placeholder = 'Plex Token';
        } else {
            apiKeyInput.placeholder = 'API Key';
        }
    }
    
    if (serverUrlInput) {
        if (serverType === 'plex') {
            serverUrlInput.placeholder = 'Plex Server URL (e.g., plex.domain.com:32400)';
        } else {
            serverUrlInput.placeholder = 'Server URL (e.g., server.domain.com:8096)';
        }
    }
}

// Function to update the theme based on server type
function updateTheme(serverType) {
    const body = document.body;
    
    // Remove existing theme classes
    body.classList.remove('theme-emby', 'theme-jellyfin', 'theme-plex');
    
    // Add the appropriate theme class
    switch(serverType) {
        case 'emby':
            body.classList.add('theme-emby');
            break;
        case 'jellyfin':
            body.classList.add('theme-jellyfin');
            break;
        case 'plex':
            body.classList.add('theme-plex');
            break;
        default:
            // Default theme (no class added)
            break;
    }
}

// Function to get current theme's primary color
function getCurrentThemeColor() {
    const serverType = document.getElementById('serverType').value;
    switch(serverType) {
        case 'emby':
            return '#52c234';
        case 'jellyfin':
            return '#00a4dc';
        case 'plex':
            return '#e5a00d';
        default:
            return '#4fc3f7'; // Default blue
    }
}

// Set default values when the page loads
document.addEventListener('DOMContentLoaded', function() {
    setDefaultValues();
    loadConfigsForCurrentServer();
    
    // Add event listener for server type changes
    const serverTypeSelect = document.getElementById('serverType');
    if (serverTypeSelect) {
        serverTypeSelect.addEventListener('change', loadConfigsForCurrentServer);
    }
});

function showDuplicatesHTML(libraryName, duplicates) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        z-index: 1000;
        overflow-y: auto;
        padding: 20px;
        box-sizing: border-box;
    `;
    
    // Create modal content
    const colors = getThemeColors();
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: ${colors.modalBackground};
        color: ${colors.textColor};
        border-radius: 10px;
        padding: 30px;
        max-width: 1400px;
        margin: 0 auto;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        position: relative;
    `;
    
    // Create close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '✕';
    closeButton.style.cssText = `
        position: absolute;
        top: 15px;
        right: 20px;
        background: #ff4757;
        color: white;
        border: none;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        font-size: 16px;
        cursor: pointer;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
    `;
    closeButton.onclick = () => document.body.removeChild(modal);
    
    // Create header
    const header = document.createElement('div');
    const themeColor = getCurrentThemeColor();
    header.innerHTML = `
        <h2 style="margin: 0 0 20px 0; color: ${themeColor};">Duplicates in "${libraryName}"</h2>
        <p style="margin: 0 0 30px 0; color: #7f8c8d;">Found ${Object.keys(duplicates).length} duplicate sets with ${Object.values(duplicates).reduce((sum, paths) => sum + paths.length, 0)} total files</p>
    `;
    
    // Create duplicates container
    const duplicatesContainer = document.createElement('div');
    
    for (const [key, paths] of Object.entries(duplicates)) {
        // Create duplicate set container
        const duplicateSet = document.createElement('div');
        duplicateSet.style.cssText = `
            margin-bottom: 30px;
            border: 1px solid ${colors.borderColor};
            border-radius: 8px;
            overflow: hidden;
            background: ${colors.containerBackground};
        `;
        
        // Parse the key to extract movie name and year
        const parts = key.split('_');
        const year = parts[parts.length - 1];
        const movieName = parts.slice(0, -1).join('_');
        
        // Get current server type for the title
        const currentServerType = document.getElementById('serverType').value;
        const serverDisplayName = currentServerType.charAt(0).toUpperCase() + currentServerType.slice(1);
        
        // Create formatted title
        const formattedTitle = `${serverDisplayName} - Duplicate Set: ${movieName} - Year: ${year}`;
        
        // Create set header
        const setHeader = document.createElement('div');
        const themeColor = getCurrentThemeColor();
        setHeader.style.cssText = `
            background: ${themeColor};
            color: white;
            padding: 15px 20px;
            font-weight: bold;
            font-size: 16px;
        `;
        setHeader.textContent = formattedTitle;
        
        // Create table
        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            background: ${colors.tableBackground};
        `;
        
        // Create table header
        const tableHeader = document.createElement('thead');
        tableHeader.innerHTML = `
            <tr style="background: ${themeColor};">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid ${colors.borderColor}; font-weight: 600; color: white;">Movie Title</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid ${colors.borderColor}; font-weight: 600; width: 80px; color: white;">Year</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid ${colors.borderColor}; font-weight: 600; width: 100px; color: white;">Size</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid ${colors.borderColor}; font-weight: 600; width: 120px; color: white;">Resolution</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid ${colors.borderColor}; font-weight: 600; width: 120px; color: white;">Quality</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid ${colors.borderColor}; font-weight: 600; width: 90px; color: white;">Video</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid ${colors.borderColor}; font-weight: 600; width: 150px; color: white;">Audio</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid ${colors.borderColor}; font-weight: 600; color: white;">File Path</th>
                <th style="padding: 12px; text-align: center; border-bottom: 2px solid ${colors.borderColor}; font-weight: 600; width: 100px; color: white;">Action</th>
            </tr>
        `;
        
        // Create table body
        const tableBody = document.createElement('tbody');
        
        // Sort paths by resolution (highest first), then by size (largest first)
        const sortedPaths = paths.sort((a, b) => {
            const aPixels = a.resolution !== 'Unknown' ? 
                parseInt(a.resolution.split('x')[0]) * parseInt(a.resolution.split('x')[1]) : 0;
            const bPixels = b.resolution !== 'Unknown' ? 
                parseInt(b.resolution.split('x')[0]) * parseInt(b.resolution.split('x')[1]) : 0;
            
            if (aPixels !== bPixels) return bPixels - aPixels;
            return b.size - a.size;
        });
        
        sortedPaths.forEach((item, index) => {
            const { path, year, size, resolution, originalName, itemId } = item;
            const formattedSize = formatFileSize(size);
            const movieTitle = originalName || 'Unknown';
            const displayYear = year ? year.toString() : 'N/A';
            
            // Determine quality badge using nearest resolution match
            let qualityBadge = '';
            let qualityColor = '#95a5a6';
            
            if (resolution !== 'Unknown' && resolution.includes('x')) {
                const [width, height] = resolution.split('x').map(num => parseInt(num));
                const result = getQualityByNearestResolution(width, height);
                qualityBadge = result.quality;
                qualityColor = result.color;
            } else {
                qualityBadge = '?';
                qualityColor = '#95a5a6';
            }
            
            const row = document.createElement('tr');
            row.style.cssText = `
                ${index === 0 ? `background: ${colors.rowFirst};` : ''}
                ${index % 2 === 1 ? `background: ${colors.rowEven};` : ''}
                color: ${colors.textColor};
            `;
            
            // Add MediaPart ID and Media ID to row for Plex individual file deletion
            if (item.mediaPartId) {
                row.dataset.mediaPartId = item.mediaPartId;
            }
            if (item.mediaId) {
                row.dataset.mediaId = item.mediaId;
            }
            
            // Create unique button ID for Plex files using mediaSourceIndex
            const serverType = document.getElementById('serverType').value;
            const deleteButtonId = serverType === 'plex' && item.mediaSourceIndex !== undefined 
                ? `delete-btn-${itemId}-source-${item.mediaSourceIndex}`
                : `delete-btn-${itemId}`;
            
            // Format codec for display
            const codecDisplay = item.codec && item.codec !== 'Unknown' ? item.codec.toUpperCase() : 'Unknown';
            const audioCodecDisplay = item.audioCodec && item.audioCodec !== 'Unknown' ? item.audioCodec : 'Unknown';
            
            row.innerHTML = `
                <td style="padding: 12px; border-bottom: 1px solid ${colors.borderColor}; font-weight: 500; color: ${colors.textColor};">${movieTitle}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid ${colors.borderColor}; color: ${colors.textColor};">${displayYear}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid ${colors.borderColor}; font-weight: 500; color: ${colors.textColor};">${formattedSize}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid ${colors.borderColor}; font-family: monospace; color: ${colors.textColor};">${resolution}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid ${colors.borderColor}; white-space: nowrap;">
                    <span style="background: ${qualityColor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; white-space: nowrap;">${qualityBadge}</span>
                </td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid ${colors.borderColor}; font-family: monospace; font-size: 11px; color: ${colors.textColor}; font-weight: 500;">${codecDisplay}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid ${colors.borderColor}; font-family: monospace; font-size: 11px; color: ${colors.textColor}; font-weight: 500;">${audioCodecDisplay}</td>
                <td style="padding: 12px; border-bottom: 1px solid ${colors.borderColor}; font-family: monospace; font-size: 12px; color: ${colors.textColor}; word-break: break-all;" title="${path}">${path}</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid ${colors.borderColor};">
                    <button id="${deleteButtonId}" style="
                        background: #e74c3c;
                        color: white;
                        border: none;
                        padding: 6px 12px;
                        border-radius: 4px;
                        font-size: 12px;
                        cursor: pointer;
                        font-weight: 500;
                        transition: background 0.2s;
                    " onmouseover="this.style.background='#c0392b'" onmouseout="this.style.background='#e74c3c'">
                        🗑️ Delete
                    </button>
                </td>
            `;
            
            tableBody.appendChild(row);
            
            // Add click event listener for the delete button
            setTimeout(() => {
                const deleteBtn = document.getElementById(deleteButtonId);
                if (deleteBtn) {
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        deleteMovieFromServer(itemId, movieTitle, row);
                    };
                }
            }, 0);
        });
        
        table.appendChild(tableHeader);
        table.appendChild(tableBody);
        
        duplicateSet.appendChild(setHeader);
        duplicateSet.appendChild(table);
        duplicatesContainer.appendChild(duplicateSet);
    }
    
    // Add download button
    const downloadButton = document.createElement('button');
    downloadButton.textContent = 'Download as Text File';
    downloadButton.style.cssText = `
        background: #2ecc71;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        margin-top: 20px;
        font-weight: 500;
    `;
    downloadButton.onclick = () => downloadDuplicates(libraryName, duplicates);
    
    // Assemble modal
    modalContent.appendChild(closeButton);
    modalContent.appendChild(header);
    modalContent.appendChild(duplicatesContainer);
    modalContent.appendChild(downloadButton);
    modal.appendChild(modalContent);
    
    // Add to page
    document.body.appendChild(modal);
    
    // Close on background click
    modal.onclick = (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    };
    
    // Close on Escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            document.body.removeChild(modal);
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

function clearSavedData() {
    localStorage.removeItem('serverType');
    localStorage.removeItem('serverUrl');
    localStorage.removeItem('apiKey');
    
    // Clear the form fields
    const serverTypeSelect = document.getElementById('serverType');
    const serverUrlInput = document.getElementById('serverUrl');
    const apiKeyInput = document.getElementById('apiKey');
    
    if (serverTypeSelect) {
        serverTypeSelect.value = 'emby';
    }
    
    if (serverUrlInput) {
        serverUrlInput.value = '';
    }
    
    if (apiKeyInput) {
        apiKeyInput.value = '';
    }
    
    alert('Saved data cleared!');
}

function exportSettings() {
    const settings = {
        serverType: localStorage.getItem('serverType') || 'emby',
        serverUrl: localStorage.getItem('serverUrl') || '',
        apiKey: localStorage.getItem('apiKey') || '',
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'media-server-dupe-finder-settings.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const settings = JSON.parse(e.target.result);
                    
                    if (settings.serverType) {
                        localStorage.setItem('serverType', settings.serverType);
                        const typeSelect = document.getElementById('serverType');
                        if (typeSelect) typeSelect.value = settings.serverType;
                    }
                    
                    if (settings.serverUrl) {
                        localStorage.setItem('serverUrl', settings.serverUrl);
                        const urlInput = document.getElementById('serverUrl');
                        if (urlInput) urlInput.value = settings.serverUrl;
                    }
                    
                    if (settings.apiKey) {
                        localStorage.setItem('apiKey', settings.apiKey);
                        const keyInput = document.getElementById('apiKey');
                        if (keyInput) keyInput.value = settings.apiKey;
                    }
                    
                    // Handle legacy settings
                    if (settings.embyServerUrl) {
                        localStorage.setItem('serverUrl', settings.embyServerUrl);
                        const urlInput = document.getElementById('serverUrl');
                        if (urlInput) urlInput.value = settings.embyServerUrl;
                    }
                    
                    if (settings.embyApiKey) {
                        localStorage.setItem('apiKey', settings.embyApiKey);
                        const keyInput = document.getElementById('apiKey');
                        if (keyInput) keyInput.value = settings.embyApiKey;
                    }
                    
                    alert('Settings imported successfully!');
                } catch (error) {
                    alert('Error importing settings: Invalid JSON file');
                }
            };
            reader.readAsText(file);
        }
    };
    
    input.click();
}

// Theme toggle function
function toggleTheme() {
    const body = document.body;
    const themeToggle = document.querySelector('.theme-toggle');
    
    if (body.classList.contains('light-mode')) {
        // Switch to dark mode
        body.classList.remove('light-mode');
        themeToggle.textContent = '🌓';
        localStorage.setItem('theme', 'dark');
    } else {
        // Switch to light mode
        body.classList.add('light-mode');
        themeToggle.textContent = '☀️';
        localStorage.setItem('theme', 'light');
    }
}

// Load saved theme on page load
function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    const body = document.body;
    const themeToggle = document.querySelector('.theme-toggle');
    
    if (savedTheme === 'light') {
        body.classList.add('light-mode');
        if (themeToggle) themeToggle.textContent = '☀️';
    } else {
        // Default to dark mode, remove any light-mode class
        body.classList.remove('light-mode');
        if (themeToggle) themeToggle.textContent = '🌓';
        // Set default theme to dark if none is saved
        if (!savedTheme) {
            localStorage.setItem('theme', 'dark');
        }
    }
}

// Load theme when page loads
document.addEventListener('DOMContentLoaded', loadTheme);

// Helper function to get theme colors
function getThemeColors() {
    const isLightMode = document.body.classList.contains('light-mode');
    return {
        modalBackground: isLightMode ? 'white' : '#2e445e',
        tableBackground: isLightMode ? 'white' : '#2e445e',
        rowEven: isLightMode ? '#f8f9fa' : '#1e2738',
        rowFirst: isLightMode ? '#e8f5e8' : '#2e445e',
        containerBackground: isLightMode ? '#f8f9fa' : '#1e2738',
        textColor: isLightMode ? '#333333' : '#ffffff',
        borderColor: isLightMode ? '#e1e8ed' : '#1e2738'
    };
}

// Function to delete a movie from media server library (Emby/Jellyfin/Plex)
async function deleteMovieFromServer(itemId, movieTitle, rowElement) {
    const serverType = document.getElementById('serverType').value;
    const serverUrl = document.getElementById('serverUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value;
    
    // For Plex, check if this specific file has already been deleted
    if (serverType === 'plex') {
        const deleteBtn = rowElement.querySelector('button');
        const buttonId = deleteBtn ? deleteBtn.id : null;
        const deletedFiles = window.deletedPlexFiles || new Set();
        if (buttonId && deletedFiles.has(buttonId)) {
            alert('This file has already been deleted from Plex. Please refresh the page to see updated results.');
            return;
        }
    }
    
    if (!serverUrl || !apiKey) {
        const authType = serverType === 'plex' ? 'token' : 'API key';
        alert(`${serverType.charAt(0).toUpperCase() + serverType.slice(1)} server URL and ${authType} are required for deletion`);
        return;
    }
    
    // Confirm deletion - consistent format for all server types
    const fileSize = rowElement.querySelector('td:nth-child(3)').textContent || 'Unknown';
    const filePath = rowElement.querySelector('td:nth-last-child(2)').textContent || 'Unknown';
    
    const confirmMessage = `Are you sure you want to delete "${movieTitle}" file size ${fileSize}\n\nThis will delete ONLY the selected file:\n"${filePath}"\n\nThe other quality versions of "${movieTitle}" will remain.\nThis will remove the movie from ${serverType.charAt(0).toUpperCase() + serverType.slice(1)} and delete the actual file from your server.\n\nContinue with deleting this specific file?`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        // Disable the delete button to prevent multiple clicks
        const deleteBtn = rowElement.querySelector('button');
        const originalButtonId = deleteBtn ? deleteBtn.id : null;
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.textContent = 'Deleting...';
            deleteBtn.style.background = '#95a5a6';
        }
        
        let fullServerUrl = serverUrl;
        if (!/^https?:\/\//i.test(fullServerUrl)) {
            fullServerUrl = 'http://' + fullServerUrl;
        }
        
        let response;
        
        if (serverType === 'plex') {
            // Use Plex API deletion for individual files
            console.log('Attempting Plex API deletion for individual file');
            
            // Get Media ID from row data for more reliable deletion
            const mediaId = rowElement.dataset.mediaId;
            const mediaPartId = rowElement.dataset.mediaPartId;
            console.log('MediaId from row:', mediaId);
            console.log('MediaPartId from row:', mediaPartId);
            console.log('Row dataset:', rowElement.dataset);
            
            // First check if "Allow media deletion" is enabled by testing a simple API call
            const testResponse = await fetch(`${fullServerUrl}/library/metadata/${itemId}?X-Plex-Token=${apiKey}`);
            if (!testResponse.ok) {
                throw new Error('Cannot access Plex movie metadata. Check your server URL and token.');
            }
            
            if (mediaId) {
                // Delete by Media ID - removes a specific quality version
                console.log('Deleting Plex Media ID:', mediaId);
                console.log('DELETE URL:', `${fullServerUrl}/library/metadata/${itemId}/media/${mediaId}?X-Plex-Token=${apiKey}`);
                response = await fetch(`${fullServerUrl}/library/metadata/${itemId}/media/${mediaId}?X-Plex-Token=${apiKey}`, {
                    method: 'DELETE'
                });
            } else if (mediaPartId) {
                // Fallback: Delete by Part ID - removes a single file
                console.log('No Media ID available, trying Part ID:', mediaPartId);
                console.log('DELETE URL:', `${fullServerUrl}/library/parts/${mediaPartId}?X-Plex-Token=${apiKey}`);
                response = await fetch(`${fullServerUrl}/library/parts/${mediaPartId}?X-Plex-Token=${apiKey}`, {
                    method: 'DELETE'
                });
            } else {
                // Final fallback: Delete entire movie if no specific IDs available
                console.log('No Media or Part ID available, deleting entire Plex movie:', itemId);
                console.log('DELETE URL:', `${fullServerUrl}/library/metadata/${itemId}?X-Plex-Token=${apiKey}`);
                response = await fetch(`${fullServerUrl}/library/metadata/${itemId}?X-Plex-Token=${apiKey}`, {
                    method: 'DELETE'
                });
            }
            
            console.log('Plex API deletion response:', response.status, response.statusText);
            
            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error('Plex deletion forbidden. Please enable "Allow media deletion" in Plex Settings > Library.');
                } else if (response.status === 404) {
                    throw new Error(`Plex item not found. The file may have already been deleted or the Media ID (${mediaId}) / Part ID (${mediaPartId}) is invalid.`);
                } else {
                    throw new Error(`Plex deletion failed: ${response.status} ${response.statusText}`);
                }
            }
        } else {
            // Emby/Jellyfin
            const endpoint = serverType === 'jellyfin' ? '/Items' : '/emby/Items';
            response = await fetch(`${fullServerUrl}${endpoint}/${itemId}?api_key=${apiKey}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        }
        
        if (response.ok) {
            // For Plex, track deleted files and disable only the specific button that was clicked
            if (serverType === 'plex') {
                if (!window.deletedPlexFiles) {
                    window.deletedPlexFiles = new Set();
                }
                // Track the specific button that was clicked, not the whole movie
                if (originalButtonId) {
                    window.deletedPlexFiles.add(originalButtonId);
                }
                
                // Only disable the specific button that was clicked
                if (deleteBtn) {
                    deleteBtn.disabled = true;
                    deleteBtn.textContent = 'Deleted';
                    deleteBtn.style.background = '#95a5a6';
                }
            } else {
                // For Emby/Jellyfin, disable all buttons for the movie (original behavior)
                if (!window.deletedMovies) {
                    window.deletedMovies = new Set();
                }
                window.deletedMovies.add(itemId);
                
                // Disable all other delete buttons for this movie ID
                try {
                    const allDeleteButtons = document.querySelectorAll('button[id*="delete-btn-"]');
                    if (allDeleteButtons) {
                        allDeleteButtons.forEach(btn => {
                            if (btn.id.includes(`delete-btn-${itemId}`)) {
                                btn.disabled = true;
                                btn.textContent = 'Deleted';
                                btn.style.background = '#95a5a6';
                            }
                        });
                    }
                } catch (error) {
                    console.log('Error disabling delete buttons:', error);
                }
            }
            
            // Success - remove the row from the table
            rowElement.style.transition = 'opacity 0.3s, transform 0.3s';
            rowElement.style.opacity = '0.5';
            rowElement.style.transform = 'scale(0.95)';
            
            setTimeout(() => {
                rowElement.remove();
                
                // Check if this was the last row in the duplicate set
                const table = rowElement.closest('table');
                const remainingRows = table.querySelectorAll('tbody tr').length;
                
                if (remainingRows === 0) {
                    // Remove the entire duplicate set if no movies remain
                    const duplicateSet = table.closest('div');
                    duplicateSet.style.transition = 'opacity 0.3s, transform 0.3s';
                    duplicateSet.style.opacity = '0';
                    duplicateSet.style.transform = 'scale(0.95)';
                    
                    setTimeout(() => {
                        duplicateSet.remove();
                        
                        // Update the header count
                        updateDuplicateCount();
                    }, 300);
                }
            }, 300);
            
            // Show success message
            let successMessage;
            if (serverType === 'plex') {
                const filePath = rowElement.querySelector('td:nth-last-child(2)').textContent || 'Unknown';
                const fileName = filePath.split('/').pop();
                successMessage = `Individual file "${fileName}" has been successfully deleted. Plex library refreshed.`;
            } else {
                successMessage = `"${movieTitle}" has been successfully deleted from ${serverType.charAt(0).toUpperCase() + serverType.slice(1)} library`;
            }
            showNotification(successMessage, 'success');
            
        } else if (response.status === 404) {
            showNotification(`Movie "${movieTitle}" was not found in ${serverType.charAt(0).toUpperCase() + serverType.slice(1)} (may have already been deleted)`, 'warning');
            rowElement.remove();
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
    } catch (error) {
        console.error('Error deleting movie:', error);
        showNotification(`Failed to delete "${movieTitle}": ${error.message}`, 'error');
        
        // Re-enable the button on error
        const deleteBtn = rowElement.querySelector('button');
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = '🗑️ Delete';
            deleteBtn.style.background = '#e74c3c';
        }
    }
}

// Function to show notifications
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        max-width: 400px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        animation: slideIn 0.3s ease-out;
    `;
    
    // Set background color based on type
    switch (type) {
        case 'success':
            notification.style.background = '#27ae60';
            break;
        case 'error':
            notification.style.background = '#e74c3c';
            break;
        case 'warning':
            notification.style.background = '#f39c12';
            break;
        default:
            notification.style.background = '#3498db';
    }
    
    notification.textContent = message;
    
    // Add slide-in animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
    
    // Allow manual dismissal by clicking
    notification.onclick = () => {
        notification.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    };
}

// Function to update duplicate count in the modal header
function updateDuplicateCount() {
    const modal = document.querySelector('div[style*="position: fixed"]');
    if (modal) {
        const duplicatesContainer = modal.querySelector('div').children[1]; // Get duplicates container
        const remainingSets = duplicatesContainer.querySelectorAll('div[style*="margin-bottom: 30px"]').length;
        const totalFiles = duplicatesContainer.querySelectorAll('tbody tr').length;
        
        const header = modal.querySelector('h2').nextElementSibling;
        header.innerHTML = `Found ${remainingSets} duplicate sets with ${totalFiles} total files`;
        
        // If no duplicates remain, show completion message
        if (remainingSets === 0) {
            duplicatesContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #27ae60;">
                    <h3>🎉 All duplicates have been removed!</h3>
                    <p>You can close this window now.</p>
                </div>
            `;
        }
    }
}

// Config management functions

// Load configs for the current server type
async function loadConfigsForCurrentServer() {
    const serverType = document.getElementById('serverType').value;
    const configSelect = document.getElementById('configSelect');
    const loadConfigBtn = document.getElementById('loadConfigBtn');
    const deleteConfigBtn = document.getElementById('deleteConfigBtn');
    
    try {
        const response = await fetch(`/api/configs/${serverType}`);
        const configs = await response.json();
        
        // Clear existing options
        configSelect.innerHTML = '<option value="">Select saved config...</option>';
        
        if (configs.length > 0) {
            // Add config options
            configs.forEach(config => {
                const option = document.createElement('option');
                option.value = config.filename;
                option.textContent = config.displayName;
                option.dataset.config = JSON.stringify(config);
                configSelect.appendChild(option);
            });
            
            // Show the config controls
            configSelect.style.display = 'block';
            loadConfigBtn.style.display = 'block';
            deleteConfigBtn.style.display = 'block';
        } else {
            // Hide the config controls if no configs
            configSelect.style.display = 'none';
            loadConfigBtn.style.display = 'none';
            deleteConfigBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading configs:', error);
    }
}

// Load selected config
function loadSelectedConfig() {
    const configSelect = document.getElementById('configSelect');
    const selectedOption = configSelect.options[configSelect.selectedIndex];
    
    if (selectedOption.value && selectedOption.dataset.config) {
        const config = JSON.parse(selectedOption.dataset.config);
        
        // Populate form fields
        document.getElementById('serverType').value = config.serverType;
        document.getElementById('serverUrl').value = config.serverUrl;
        document.getElementById('apiKey').value = config.apiKey;
        
        // Update theme and placeholder
        updatePlaceholderForServerType(config.serverType);
        updateTheme(config.serverType);
        
        // Show success message
        showNotification(`Config "${config.displayName}" loaded successfully`, 'success');
    }
}

// Delete selected config
async function deleteSelectedConfig() {
    const configSelect = document.getElementById('configSelect');
    const selectedOption = configSelect.options[configSelect.selectedIndex];
    
    if (selectedOption.value && selectedOption.dataset.config) {
        const config = JSON.parse(selectedOption.dataset.config);
        
        if (confirm(`Are you sure you want to delete the config "${config.displayName}"?`)) {
            try {
                const response = await fetch(`/api/configs/${config.serverType}/${config.filename}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    showNotification(`Config "${config.displayName}" deleted successfully`, 'success');
                    loadConfigsForCurrentServer(); // Refresh the list
                } else {
                    const error = await response.json();
                    showNotification(`Error deleting config: ${error.error}`, 'error');
                }
            } catch (error) {
                console.error('Error deleting config:', error);
                showNotification('Error deleting config', 'error');
            }
        }
    }
}

// Save config if checkbox is checked
async function saveConfigIfChecked() {
    const saveConfigCheckbox = document.getElementById('saveConfig');
    
    if (saveConfigCheckbox.checked) {
        const serverType = document.getElementById('serverType').value;
        const serverUrl = document.getElementById('serverUrl').value.trim();
        const apiKey = document.getElementById('apiKey').value.trim();
        
        if (!serverUrl || !apiKey) {
            showNotification('Server URL and API Key are required to save config', 'error');
            return;
        }
        
        try {
            const response = await fetch(`/api/configs/${serverType}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    serverUrl,
                    apiKey
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                showNotification(`Config saved as "${result.config.serverUrl}"`, 'success');
                
                // Uncheck the save checkbox
                saveConfigCheckbox.checked = false;
                
                // Refresh the config list
                loadConfigsForCurrentServer();
            } else {
                const error = await response.json();
                showNotification(`Error saving config: ${error.error}`, 'error');
            }
        } catch (error) {
            console.error('Error saving config:', error);
            showNotification('Error saving config', 'error');
        }
    }
}