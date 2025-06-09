const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000; // Use 3000 as default but allow env variable override
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const UPLOADS_DIR = '/root';

// Trust proxy when behind nginx
app.set('trust proxy', true);

// Add CORS headers for nginx proxy (only once)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

// Multer config: 5GB limit with original filenames
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB
});

// Serve static files from uploads directory with "download" attribute
app.use('/uploads', (req, res, next) => {
    // Get the full path to the requested file
    const filePath = path.join(UPLOADS_DIR, decodeURIComponent(req.path));
    
    // If it's a direct file request, set Content-Disposition to force download
    fs.stat(filePath, (err, stats) => {
        if (!err && stats.isFile()) {
            const fileName = path.basename(filePath);
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        }
        next();
    });
}, express.static(UPLOADS_DIR));

// Serve frontend HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    res.send('File uploaded successfully.');
});

// List uploaded files (hide dotfiles)
app.get('/files', (req, res) => {
    fs.readdir(UPLOADS_DIR, { withFileTypes: true }, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Unable to list files.' });
        }
        // Filter out dotfiles and return type info
        const visibleFiles = files
            .filter(f => !f.name.startsWith('.'))
            .map(f => ({ name: f.name, type: f.isDirectory() ? 'directory' : 'file' }));
        res.json(visibleFiles);
    });
});

// Delete file or empty directory endpoint
app.delete('/file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Check if file exists
    fs.stat(filePath, (err, stats) => {
        if (err) {
            return res.status(404).json({ error: 'File or directory not found.' });
        }
        if (stats.isFile()) {
            // Delete file
            fs.unlink(filePath, (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to delete file.' });
                }
                res.json({ success: true, message: 'File deleted successfully.' });
            });
        } else if (stats.isDirectory()) {
            // Delete directory recursively (CAUTION: this will delete all contents)
            fs.rm(filePath, { recursive: true, force: true }, (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Failed to delete directory.' });
                }
                res.json({ success: true, message: 'Directory deleted successfully.' });
            });
        } else {
            res.status(400).json({ error: 'Not a file or directory.' });
        }
    });
});

// Read SSL certificates
const options = {
    key: fs.readFileSync(path.join(__dirname, 'ssl/key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'ssl/cert.pem'))
};

// Create HTTP server
http.createServer(app).listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP server running on http://0.0.0.0:${PORT}`);
});

// Create HTTPS server that redirects to HTTP
https.createServer(options, (req, res) => {
    // Get host from request or use default
    const host = req.headers['host'] ? req.headers['host'].split(':')[0] : req.socket.localAddress;
    // Create redirect URL (HTTP) - use the actual external IP
    const redirectUrl = `http://${host}${req.url}`;
    
    console.log(`Redirecting HTTPS request from ${req.socket.remoteAddress} to ${redirectUrl}`);
    
    // Set redirect headers
    res.writeHead(301, { 'Location': redirectUrl });
    res.end();
}).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`HTTPS redirect server running on https://0.0.0.0:${HTTPS_PORT}`);
});
