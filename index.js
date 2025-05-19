const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 80;
const HTTPS_PORT = 443;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

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

// List uploaded files
app.get('/files', (req, res) => {
    fs.readdir(UPLOADS_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Unable to list files.' });
        }
        res.json(files);
    });
});

// Delete file endpoint
app.delete('/file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(UPLOADS_DIR, filename);
    
    // Check if file exists
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            return res.status(404).json({ error: 'File not found.' });
        }
        
        // Delete the file
        fs.unlink(filePath, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete file.' });
            }
            res.json({ success: true, message: 'File deleted successfully.' });
        });
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
