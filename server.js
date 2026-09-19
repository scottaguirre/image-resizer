const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const upload = multer({
  dest: path.join(os.tmpdir(), 'uploads'),
  limits: { fileSize: 40 * 1024 * 1024 } // 40 MB per image
});

// Optional password protection.
// Set the SITE_PASSWORD environment variable in Render to turn this on.
// If it is not set, the app is open to anyone with the URL.
const SITE_PASSWORD = process.env.SITE_PASSWORD;
if (SITE_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const supplied = decoded.slice(decoded.indexOf(':') + 1);
      if (supplied === SITE_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Image Resizer"');
    return res.status(401).send('Password required.');
  });
}


// Fixed dimensions + desired filenames
const sizes = [
    { width: 1400, height: 700, label: 'hero-large' },
    { width: 1250, height: 700, label: 'hero-desktop' },
    { width: 750,  height: 400, label: 'hero-tablet' },
    { width: 600,  height: 350, label: 'hero-mobile' }
  ];
  

app.get('/', (req, res) => {
  res.send(`
    <html>
        <head>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        </head>
        <body style="font-family:sans-serif">
            <div class="container" style="padding-top: 100px;">
                <div class="row justify-content-md-center">
                    <div class="col-6">
                        <h2>Hero Image Resizer: 4 different dimensions </h2>
                        <form action="/resize" method="post" enctype="multipart/form-data">
                            <p><input class="form-control" type="file" name="images" accept="image/*" multiple required></p>
                            <p>Output format: 
                            <select class="form-select" name="format">
                                <option value="webp" selected>WebP</option>
                                <option value="avif">AVIF</option>
                                <option value="jpg">JPG</option>
                                <option value="png">PNG</option>
                            </select>
                            </p>
                            <p>Quality (1-100): <input type="number" name="quality" value="75" min="1" max="100"></p>
                            <button class="btn btn-primary" type="submit">Upload & Resize Hero</button>
                        </form>

                        <hr/>
                        </br>
                        <h2>Batch 600×400 Resizer (Multiple Images)</h2>
                        <form action="/resize-600x400" method="post" enctype="multipart/form-data">
                            <p><input class="form-control" type="file" name="images" accept="image/*" multiple required></p>
                            <p>Output format:
                            <select class="form-select" name="format">
                                <option value="webp" selected>WebP</option>
                                <option value="avif">AVIF</option>
                                <option value="jpg">JPG</option>
                                <option value="png">PNG</option>
                            </select>
                            </p>
                            <p>Quality (1-100): <input type="number" name="quality" value="75" min="1" max="100"></p>
                            <button class="btn btn-success" type="submit">Upload & Resize to 600×400 (ZIP)</button>
                        </form>
                    </div>
                </div>
            </div>
        </body>
    </html>
  `);
});


// Multi-file upload for the 4-size pipeline
app.post('/resize', upload.array('images', 100), async (req, res) => {
    const format = (req.body.format || 'webp').toLowerCase();
    const quality = parseInt(req.body.quality, 10) || 75;
    const validFormats = new Set(['jpg','jpeg','png','webp','avif']);
    const outFormat = validFormats.has(format) ? format : 'webp';
    const ext = outFormat === 'jpeg' ? 'jpg' : outFormat;
  
    if (!req.files || req.files.length === 0) {
      return res.status(400).send('No files uploaded.');
    }

    // IMPORTANT: We rely on req.files order (browser selection order)
    const filesInSelectionOrder = req.files.slice(); // keep as-is

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="resized-images.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    // Do not throw here: an uncaught throw would take the whole server down
    // for everyone, not just this request.
    archive.on('error', err => { console.error(err); res.destroy(err); });
    archive.pipe(res);
  
    try {
      let pageCounter = 0;
      let folder;
  
      // Process sequentially to preserve folder sequence in ZIP
      for (const file of filesInSelectionOrder) {
        if(pageCounter === 0){
            folder = `AboutUs-hero`;
        }else{
            folder = `hero${pageCounter}`;
        }

        
  
        for (const { width, height, label } of sizes) {
          let img = sharp(file.path).resize(width, height, { fit: 'cover' });
  
          switch (outFormat) {
            case 'jpg':
            case 'jpeg': img = img.jpeg({ quality, progressive: true }); break;
            case 'png':  img = img.png({ compressionLevel: 9 }); break;
            case 'webp': img = img.webp({ quality }); break;
            case 'avif': img = img.avif({ quality }); break;
          }
  
          const buffer = await img.toBuffer();
  
          // Store inside pageX folder with fixed filename
          archive.append(buffer, { name: `${folder}/${label}.${ext}` });
        }
  
        fs.unlink(file.path, () => {}); // cleanup temp file
        pageCounter++;
      }
  
      await archive.finalize();
    } catch (e) {
      console.error(e);
      // Headers are already sent once the ZIP starts streaming, so a normal
      // 500 response is no longer possible at that point.
      if (!res.headersSent) {
        res.status(500).end('Error processing images.');
      } else {
        archive.abort();
        res.destroy();
      }
    }
});
  



// Batch 600x400 → grouped 4-per-page into section2 & section4 folders
app.post('/resize-600x400', upload.array('images', 400), async (req, res) => {
    const format = (req.body.format || 'webp').toLowerCase();
    const quality = parseInt(req.body.quality, 10) || 80;
    const validFormats = new Set(['jpg','jpeg','png','webp','avif']);
    const outFormat = validFormats.has(format) ? format : 'webp';
    const ext = outFormat === 'jpeg' ? 'jpg' : outFormat;
  
    if (!req.files || req.files.length === 0) {
      return res.status(400).send('No files uploaded.');
    }
  
    // Preserve selection order exactly
    const files = req.files.slice();
  
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="resized-600x400-structured.zip"');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { console.error(err); res.destroy(err); });
    archive.pipe(res);
  
    // Helper to process one file and append into zip at a given path
    async function processAndAppend(file, targetPath) {
      let img = sharp(file.path).resize(600, 400, { fit: 'cover' });
      switch (outFormat) {
        case 'jpg':
        case 'jpeg': img = img.jpeg({ quality, progressive: true }); break;
        case 'png':  img = img.png({ compressionLevel: 9 }); break;
        case 'webp': img = img.webp({ quality }); break;
        case 'avif': img = img.avif({ quality }); break;
      }
      const buffer = await img.toBuffer();
      archive.append(buffer, { name: targetPath });
    }
  
    try {
      let page = 1;
      for (let i = 0; i < files.length; ) {
        const baseFolder = `page${page}`;
  
        // slots in order: 2 for section2, 2 for section4
        const slots = [
          { sub: 'section2', name: 'section2-1' },
          { sub: 'section2', name: 'section2-2' },
          { sub: 'section4', name: 'section4-1' },
          { sub: 'section4', name: 'section4-2' }
        ];
  
        for (const slot of slots) {
          if (i >= files.length) break; // no more files
          const file = files[i++];
          const target = `${baseFolder}/${slot.sub}/${slot.name}.${ext}`;
          // process & add
          // eslint-disable-next-line no-await-in-loop
          await processAndAppend(file, target);
          // cleanup temp file
          fs.unlink(file.path, () => {});
        }
  
        page++;
      }
  
      await archive.finalize();
    } catch (e) {
      console.error(e);
      // Headers are already sent once the ZIP starts streaming, so a normal
      // 500 response is no longer possible at that point.
      if (!res.headersSent) {
        res.status(500).end('Error processing images.');
      } else {
        archive.abort();
        res.destroy();
      }
    }
});
  



const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running → http://localhost:${PORT}`));
