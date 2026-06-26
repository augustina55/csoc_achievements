const CONFIG = {
  HCTI_USER_ID:    '01KTSGCDKA3JRR6VEXMGQDXGE9',
  HCTI_API_KEY:    '019eb306-366a-7e47-8de2-40d7585e6296',
  LOGO_URL:        'https://drive.google.com/file/d/1xTZDoM5KzrXz5ggA9v1jqbeheV-ZPB6l/view?usp=sharing',
  MEDAL_URL:       'https://drive.google.com/file/d/1hJeiqBtRO69miXbAFujtoIJMlFI9CWor/view?usp=sharing',
  CHESS_URL:       'https://drive.google.com/file/d/1wimHMqAlb3iaSPmWX0lvPtDwuEnJoSwu/view?usp=sharing',
  OUTPUT_FOLDER:   'Chess Champ Posters',
  SHEET_NAME:      ''
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Poster Tools')
    .addItem('Generate All Posters',  'generatePosters')
    .addItem('Generate Selected Row', 'generateSelectedRow')
    .addToUi();
}

function generatePosters() {
  const setup  = getSheetSetup();
  const folder = getOrCreateFolder(CONFIG.OUTPUT_FOLDER);
  const logoDataUri  = getDriveImageAsDataUri(CONFIG.LOGO_URL);
  const medalDataUri = getDriveImageAsDataUri(CONFIG.MEDAL_URL);
  const chessDataUri = getDriveImageAsDataUri(CONFIG.CHESS_URL);

  setup.rows.forEach((row, index) => {
    const name = row[setup.col.name];
    if (!name) return;
    try {
      const url = createPosterImage(row, setup.col, folder, logoDataUri, medalDataUri, chessDataUri);
      setup.sheet.getRange(index + 2, setup.downloadCol + 1).setValue(url);
    } catch (err) {
      setup.sheet.getRange(index + 2, setup.downloadCol + 1).setValue('ERROR: ' + err.message);
      Logger.log(err);
    }
  });
  SpreadsheetApp.getUi().alert('All posters generated.');
}

function generateSelectedRow() {
  const setup     = getSheetSetup();
  const rowNumber = setup.sheet.getActiveCell().getRow();
  if (rowNumber < 2) { SpreadsheetApp.getUi().alert('Select a data row.'); return; }

  const row = setup.sheet.getRange(rowNumber, 1, 1, setup.sheet.getLastColumn()).getValues()[0];
  const logoDataUri  = getDriveImageAsDataUri(CONFIG.LOGO_URL);
  const medalDataUri = getDriveImageAsDataUri(CONFIG.MEDAL_URL);
  const chessDataUri = getDriveImageAsDataUri(CONFIG.CHESS_URL);
  const folder = getOrCreateFolder(CONFIG.OUTPUT_FOLDER);
  const url    = createPosterImage(row, setup.col, folder, logoDataUri, medalDataUri, chessDataUri);
  setup.sheet.getRange(rowNumber, setup.downloadCol + 1).setValue(url);
  SpreadsheetApp.getUi().alert('Done');
}

function createPosterImage(row, col, folder, logoDataUri, medalDataUri, chessDataUri) {
  const name         = String(row[col.name]         || '').trim();
  const rank         = String(row[col.rank]         || '').trim();
  const achievements = String(row[col.achievements] || '').trim();
  const rawPhotoUrl  = String(row[col.imageUrl]     || '').trim();
  const photoDataUri = getImageAsDataUri(rawPhotoUrl);
  const html         = buildHtml(name, rank, achievements, photoDataUri, logoDataUri, medalDataUri, chessDataUri);
  const imageUrl     = callHctiApi(html);
  return saveToDrive(imageUrl, name, folder);
}

function randomPastelColor() {
  const colors = [
    '#ff6b6b',  // coral red
    '#f7a440',  // orange
    '#f9e04b',  // yellow
    '#6bcb77',  // green
    '#4dabf7',  // blue
    '#da77f2',  // purple
    '#f06595',  // pink
    '#38d9a9',  // teal
    '#748ffc',  // indigo
    '#ff922b',  // amber
    '#20c997',  // emerald
    '#cc5de8',  // violet
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function lightenColor(hex, amount) {
  const num = parseInt(hex.replace('#',''), 16);
  const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  const lr = Math.min(255, Math.round(r + (255-r)*amount));
  const lg = Math.min(255, Math.round(g + (255-g)*amount));
  const lb = Math.min(255, Math.round(b + (255-b)*amount));
  return '#' + lr.toString(16).padStart(2,'0') + lg.toString(16).padStart(2,'0') + lb.toString(16).padStart(2,'0');
}

function darkenColor(hex, amount) {
  const num = parseInt(hex.replace('#',''), 16);
  const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  const dr = Math.max(0, Math.round(r*(1-amount)));
  const dg = Math.max(0, Math.round(g*(1-amount)));
  const db = Math.max(0, Math.round(b*(1-amount)));
  return '#' + dr.toString(16).padStart(2,'0') + dg.toString(16).padStart(2,'0') + db.toString(16).padStart(2,'0');
}

function getDriveImageAsDataUri(url) {
  try {
    const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (!m) return '';
    const blob = DriveApp.getFileById(m[1]).getBlob();
    return 'data:' + (blob.getContentType()||'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch(e) { Logger.log(e.message); return ''; }
}

function getImageAsDataUri(url) {
  if (!url) return '';
  try {
    const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    let blob;
    if (m) {
      blob = DriveApp.getFileById(m[1]).getBlob();
    } else {
      const r = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
      if (r.getResponseCode() !== 200) return '';
      blob = r.getBlob();
    }
    return 'data:' + (blob.getContentType()||'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch(e) { Logger.log(e.message); return ''; }
}

function buildHtml(name, rank, achievements, photoDataUri, logoDataUri, medalDataUri, chessDataUri) {

  const baseColor  = randomPastelColor();
  const stripColor = darkenColor(baseColor, 0.28);
  const bgColor    = lightenColor(baseColor, 0.62);
  const photo      = photoDataUri || '';

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background: transparent;
  display: flex;
  justify-content: center;
  align-items: center;
  font-family: Arial, Helvetica, sans-serif;
}
.poster {
  width: 540px;
  height: 700px;
  position: relative;
  overflow: hidden;
  background-color: ${bgColor};
  background-image: radial-gradient(circle, rgba(150,200,180,0.6) 2.5px, transparent 2.5px);
  background-size: 24px 24px;
}
.strip {
  position: absolute;
  left: 50px;
  top: 55px;
  width: 185px;
  height: 590px;
  background: ${stripColor};
  border-top-left-radius: 65px;
  border-bottom-left-radius: 65px;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  z-index: 2;
}
.champ-text {
  position: absolute;
  right: 305px;
  top: 55px;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  font-size: 105px;
  font-weight: 900;
  font-family: Arial Black, Arial, sans-serif;
  color: transparent;
  -webkit-text-stroke: 5px #ffffff;
  letter-spacing: 8px;
  white-space: nowrap;
  z-index: 5;
  line-height: 0.85;
}
.grid-panel {
  position: absolute;
  left: 233px;
  top: 55px;
  width: 307px;
  height: 590px;
  background-color: #ffffff;
  z-index: 2;
  border: 1.5px solid #c0c0c0;
  box-shadow: -5px 0 16px rgba(0,0,0,0.13), 5px 5px 16px rgba(0,0,0,0.09);
}
.logo-area {
  position: absolute;
  right: 12px;
}
.logo-area img {
  width: 180px;
  height: 100px;
  object-fit: contain;
  display: block;
}
.student-name {
  position: absolute;
  top: 180px;
  left: 0; right: 0;
  text-align: center;
  font-family: Georgia, serif;
  font-size: 20px;
  font-weight: bold;
  color: #2c3e50;
  padding: 0 16px;
}
.divider-solid {
  position: absolute;
  top: 220px;
  left: 16px;
  right: 16px;
  height: 2.5px;
  background: #2c3e50;
}
.achievements {
  position: absolute;
  top: 250px;
  left: 0; right: 0;
  text-align: center;
  font-size: 15px;
  color: #4f5e76;
  padding: 0 16px;
  line-height: 1.6;
}
.rank-text {
  position: absolute;
  top: 350px;
  left: 0; right: 0;
  text-align: center;
  font-size: 20px;
  font-weight: bold;
  color: #111;
  padding: 0 16px;
}
.medal {
  position: absolute;
  top: -35px;
  left: -50px;
  width: 200px;
  z-index: 10;
}
.chess {
  position: absolute;
  bottom: -40px;
  right: -30px;
  width: 260px;
  z-index: 10;
}
.profile {
  position: absolute;
  left: 48px;
  bottom: 20px;
  width: 210px;
  height: 210px;
  border-radius: 50%;
  overflow: hidden;
  background: #ddd;
  border: 4px solid ${stripColor};
  z-index: 6;
}
.profile img {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.dash-divider {
  position: absolute;
  top: 395px;
  left: 16px;
  right: 16px;
  border: none;
  border-top: 2px dashed #b0cad8;
}
.caissa-box {
  position: absolute;
  top: 412px;
  left: 14px;
  right: 14px;
  border: 2px solid #2196F3;
  border-radius: 12px;
  background: white;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 11.5px;
  font-weight: 700;
  color: #0a1825;
  white-space: nowrap;
}
.caissa-red { color: #b83030; }
</style>
</head>
<body>
<div class="poster">

  <img class="medal" src="${medalDataUri}">

  <div class="strip"></div>

  <div class="champ-text">CHAMP</div>

  <div class="grid-panel">
    <div class="logo-area">
      <img src="${logoDataUri}">
    </div>
    <div class="student-name">${esc(name)}</div>
    <div class="divider-solid"></div>
    <div class="achievements">${esc(achievements)}</div>
    <div class="rank-text">${esc(rank)}</div>
    <hr class="dash-divider">
    <div class="caissa-box">
      <svg width="20" height="20" viewBox="0 0 46 46" xmlns="http://www.w3.org/2000/svg">
        <rect x="7" y="12" width="32" height="30" rx="3" fill="#1565C0"/>
        <rect x="7" y="12" width="32" height="15" rx="3" fill="#42A5F5"/>
        <rect x="7" y="26" width="32" height="2" fill="rgba(0,0,0,0.2)"/>
        <rect x="2" y="10" width="42" height="5" rx="2.5" fill="#0D47A1"/>
        <polygon points="23,0 2,12 44,12" fill="#0D47A1"/>
        <line x1="37" y1="10" x2="42" y2="4" stroke="#0D47A1" stroke-width="2.5"/>
        <circle cx="43" cy="3" r="3" fill="#FFC107"/>
      </svg>
      Proud <span class="caissa-red">Caissa School Of Chess</span> Student
    </div>
  </div>

  ${photo ? `<div class="profile"><img src="${photo}"></div>` : ''}

  <img class="chess" src="${chessDataUri}">

</div>
</body>
</html>`;
}

function callHctiApi(html) {
  const response = UrlFetchApp.fetch('https://hcti.io/v1/image', {
    method:      'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(CONFIG.HCTI_USER_ID + ':' + CONFIG.HCTI_API_KEY)
    },
    payload: JSON.stringify({
      html:            html,
      selector:        '.poster',
      viewport_width:  550,
      viewport_height: 710
    }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(response.getContentText());
  if (!result.url) throw new Error('HCTI error: ' + response.getContentText());
  return result.url;
}

function saveToDrive(imageUrl, name, folder) {
  const blob = UrlFetchApp.fetch(imageUrl).getBlob().setName(name + '.png');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function getSheetSetup() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = CONFIG.SHEET_NAME ? ss.getSheetByName(CONFIG.SHEET_NAME) : ss.getActiveSheet();
  const data    = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim().toLowerCase());
  const col = {
    name:         headers.indexOf('name'),
    rank:         headers.indexOf('rank'),
    achievements: headers.indexOf('achievements'),
    imageUrl:     headers.indexOf('image_url')
  };
  let downloadCol = headers.indexOf('download url');
  if (downloadCol === -1) {
    downloadCol = headers.length;
    sheet.getRange(1, downloadCol + 1).setValue('Download URL');
  }
  return { sheet, rows: data.slice(1), col, downloadCol };
}

function getOrCreateFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}