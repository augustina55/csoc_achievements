function fetchLastMonthNewRatings() {
  Logger.log("===== START fetchLastMonthNewRatings =====");

  const ss = SpreadsheetApp.getActive();
  const sourceSheet = ss.getSheetByName("players");
  const now = new Date();

  // Output sheet
  const sheetName = "Last Month Got Rating";
  const outSheet =
    ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  // Clear old data
  outSheet.clearContents();

  // Headers
  outSheet.appendRow([
    "Created Time",
    "Name",
    "Mobile",
    "FIDE ID",
    "Classical",
    "Rapid",
    "Blitz",
    "Period"
  ]);

  const data = sourceSheet.getDataRange().getValues();
  data.shift(); // remove header

  Logger.log(`Players found: ${data.length}`);

  data.forEach((row, index) => {
    const mobile = row[0];
    const fideId = row[1];
    const name = row[2];

    Logger.log(`Checking ${name} (${fideId})`);

    if (!fideId) {
      Logger.log("⏭️ No FIDE ID");
      return;
    }

    try {
      const url = `https://api.chesstools.org/fide/player_history/?fide_id=${fideId}`;

      const res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true
      });

      if (res.getResponseCode() !== 200) {
        Logger.log(`❌ API failed for ${fideId}`);
        return;
      }

      const ratings = JSON.parse(res.getContentText());

      // Need at least last month data
      if (!ratings || ratings.length < 2) {
        Logger.log("⚠️ Not enough history");
        return;
      }

      // LAST MONTH
      const lastMonth = ratings[1];

      // Month before last
      const prevMonth = ratings[2] || {};

      const classical = lastMonth.classical_rating || 0;
      const rapid = lastMonth.rapid_rating || 0;
      const blitz = lastMonth.blitz_rating || 0;

      // Check if player GOT rating last month
      const gotClassical =
        (prevMonth.classical_rating || 0) === 0 &&
        classical > 0;

      const gotRapid =
        (prevMonth.rapid_rating || 0) === 0 &&
        rapid > 0;

      const gotBlitz =
        (prevMonth.blitz_rating || 0) === 0 &&
        blitz > 0;

      // Only write if got any new rating last month
      if (gotClassical || gotRapid || gotBlitz) {

        outSheet.appendRow([
          now,
          name,
          mobile,
          fideId,
          gotClassical ? classical : "",
          gotRapid ? rapid : "",
          gotBlitz ? blitz : "",
          lastMonth.period
        ]);

        Logger.log(`🎉 ${name} got new rating last month`);
      }

    } catch (e) {
      Logger.log(`❌ Error for ${fideId}: ${e}`);
    }
  });

  Logger.log("===== END fetchLastMonthNewRatings =====");
}


function checkFideRatings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const playersSheet = ss.getSheetByName('players');
  let allRatingSheet = ss.getSheetByName('ALL RATING');
  
  if (!allRatingSheet) {
    allRatingSheet = ss.insertSheet('ALL RATING');
  } else {
    allRatingSheet.clear(); 
  }
  
  allRatingSheet.appendRow([
    'Player Name', 'Mobile Number', 'FIDE ID', 
    'Standard Start', 'Rapid Start', 'Blitz Start', 
    'Standard Current', 'Rapid Current', 'Blitz Current', 
    'Start Date'
  ]);
  
  const data = playersSheet.getRange(2,1,playersSheet.getLastRow()-1,4).getValues();
  
  const currentMonth = '2026-Jan'; // can be dynamic later
  
  data.forEach(row => {
    const mobile = row[0];
    const fideId = row[1];
    const name = row[2];
    const startDate = new Date(row[3]);
    
    Logger.log(`Processing ${name} (FIDE ID: ${fideId}) starting from ${startDate.toDateString()}`);
    
    try {
      const response = UrlFetchApp.fetch(`https://api.chesstools.org/fide/player_history/?fide_id=${fideId}`, {muteHttpExceptions: true});
      
      if (response.getResponseCode() !== 200) {
        Logger.log(`⚠️ Failed to fetch for ${name}, HTTP code: ${response.getResponseCode()}`);
        return;
      }
      
      const history = JSON.parse(response.getContentText()); 
      
      if (!history || history.length === 0) {
        Logger.log(`⚠️ No history for ${name}`);
        return;
      }
      
      // Sort by period date
      history.sort((a,b)=> new Date(a.date+'-01') - new Date(b.date+'-01'));
      
      // Step 1: Initial rating at start_date month
      let initialRating = {standard: 0, rapid: 0, blitz: 0};
      for (let record of history) {
        const recordDate = new Date(record.period + '-01');
        if (recordDate.getTime() >= startDate.getTime()) {
          initialRating.standard = parseInt(record.classical_rating || 0);
          initialRating.rapid = parseInt(record.rapid_rating || 0);
          initialRating.blitz = parseInt(record.blitz_rating || 0);
          break;
        }
      }
      
      // Step 2: Current rating at specific month
      let currentRating = {standard: 0, rapid: 0, blitz: 0};
      const currentRecord = history.find(r => r.period === currentMonth);
      if (currentRecord) {
        currentRating.standard = parseInt(currentRecord.classical_rating || 0);
        currentRating.rapid = parseInt(currentRecord.rapid_rating || 0);
        currentRating.blitz = parseInt(currentRecord.blitz_rating || 0);
      }
      
      Logger.log(`${name} - Start: ${JSON.stringify(initialRating)}, Current (${currentMonth}): ${JSON.stringify(currentRating)}`);
      
      // Step 3: Compare
      let gotRating = false;
      const changedFormats = [];
      if (initialRating.standard === 0 && currentRating.standard > 0) { gotRating = true; changedFormats.push('Standard'); }
      if (initialRating.rapid === 0 && currentRating.rapid > 0) { gotRating = true; changedFormats.push('Rapid'); }
      if (initialRating.blitz === 0 && currentRating.blitz > 0) { gotRating = true; changedFormats.push('Blitz'); }
      
      if (gotRating) {
        allRatingSheet.appendRow([
          name, mobile, fideId, 
          initialRating.standard, initialRating.rapid, initialRating.blitz,
          currentRating.standard, currentRating.rapid, currentRating.blitz,
          row[3]
        ]);
        
        // Highlight changed ratings
        const lastRow = allRatingSheet.getLastRow();
        if (changedFormats.includes('Standard')) allRatingSheet.getRange(lastRow, 7).setBackground('yellow');
        if (changedFormats.includes('Rapid')) allRatingSheet.getRange(lastRow, 8).setBackground('yellow');
        if (changedFormats.includes('Blitz')) allRatingSheet.getRange(lastRow, 9).setBackground('yellow');
        
        Logger.log(`✅ Added ${name}, changed formats: ${changedFormats.join(', ')}`);
      }
      
    } catch(e) {
      Logger.log(`❌ Exception for ${name} (FIDE ID ${fideId}): ${e}`);
    }
  });
  
  SpreadsheetApp.flush();
  Logger.log('✅ Rating check completed!');
  SpreadsheetApp.getUi().alert('Rating check completed!');
}



/**************************************
 * FETCH FIDE RATINGS (FULL REFRESH)
 **************************************/
function fetchFideRatings() {
  Logger.log("===== START fetchFideRatings =====");

  const ss = SpreadsheetApp.getActive();
  const sourceSheet = ss.getSheetByName("players");
  const now = new Date();

  const ratingSheet =
    ss.getSheetByName("rating_change") || ss.insertSheet("rating_change");
  const gotSheet =
    ss.getSheetByName("Got Rating") || ss.insertSheet("Got Rating");

  /* ===== CLEAR SHEETS ===== */
  Logger.log("Clearing sheets...");
  ratingSheet.clearContents();
  gotSheet.clearContents();

  /* ---- Headers ---- */
  Logger.log("Writing headers...");
  ratingSheet.appendRow([
    "Created Time",
    "Player Name","Mobile","FIDE ID",
    "Standard","Standard Δ",
    "Rapid","Rapid Δ",
    "Blitz","Blitz Δ",
    "Period"
  ]);

  gotSheet.appendRow([
    "Created Time",
    "Name","Mobile","FIDE ID",
    "Standard","Rapid","Blitz"
  ]);

  /* ---- Existing maps ---- */
  const existingRatings = new Set();
  const gotExisting = new Set();

  const data = sourceSheet.getDataRange().getValues();
  data.shift(); // remove header

  Logger.log(`Total players found: ${data.length}`);

  data.forEach((row, index) => {
    const mobile = row[0];
    const fideId = row[1];
    const name = row[2];

    Logger.log(`Row ${index + 2}: name=${name}, fideId=${fideId}`);

    if (!fideId) {
      Logger.log("⏭️ Skipped (no FIDE ID)");
      return;
    }

    const url = `https://api.chesstools.org/fide/player_history/?fide_id=${fideId}`;
    Logger.log(`Fetching API → ${url}`);

    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    Logger.log(`API status ${res.getResponseCode()} for ${fideId}`);

    if (res.getResponseCode() !== 200) {
      Logger.log("❌ API failed");
      return;
    }

    const ratings = JSON.parse(res.getContentText());
    if (!ratings || ratings.length === 0) {
      Logger.log("⚠️ No rating history");
      return;
    }

    const cur = ratings[0];
    const prev = ratings[1] || {};

    const key = `${fideId}|${cur.period}`;
    if (existingRatings.has(key)) {
      Logger.log(`⏭️ Skipped duplicate period ${cur.period}`);
      return;
    }

    const std = cur.classical_rating || 0;
    const rap = cur.rapid_rating || 0;
    const bli = cur.blitz_rating || 0;

    Logger.log(`Ratings → STD:${std}, RAP:${rap}, BLI:${bli}`);

    ratingSheet.appendRow([
      now,
      name, mobile, fideId,
      std, std - (prev.classical_rating || 0),
      rap, rap - (prev.rapid_rating || 0),
      bli, bli - (prev.blitz_rating || 0),
      cur.period
    ]);

    Logger.log(`✔ Written rating_change for ${name}`);
    existingRatings.add(key);

    const gotStd = (prev.classical_rating || 0) === 0 && std > 0;
    const gotRap = (prev.rapid_rating || 0) === 0 && rap > 0;
    const gotBli = (prev.blitz_rating || 0) === 0 && bli > 0;

    if (
      (gotStd && !gotExisting.has(`${fideId}|STD`)) ||
      (gotRap && !gotExisting.has(`${fideId}|RAPID`)) ||
      (gotBli && !gotExisting.has(`${fideId}|BLITZ`))
    ) {
      gotSheet.appendRow([
        now,
        name, mobile, fideId,
        gotStd ? std : "",
        gotRap ? rap : "",
        gotBli ? bli : ""
      ]);

      Logger.log(`🎉 First rating written for ${name}`);

      if (gotStd) gotExisting.add(`${fideId}|STD`);
      if (gotRap) gotExisting.add(`${fideId}|RAPID`);
      if (gotBli) gotExisting.add(`${fideId}|BLITZ`);
    }
  });

  Logger.log("===== END fetchFideRatings =====");
}





/******************************************************
 * FETCH CHESS-RESULTS PLAYER DETAILS (FULL REFRESH)
 ******************************************************/
function fetchChessResultsPlayerDetailsByFide() {
  Logger.log("===== START: fetchChessResultsPlayerDetailsByFide =====");

  const ss = SpreadsheetApp.getActive();
  const tz = Session.getScriptTimeZone();
  const now = new Date();

  const today = new Date();
  today.setHours(0,0,0,0);

  const playersSheet = ss.getSheetByName("players");
  const players = playersSheet.getDataRange().getValues();
  players.shift();

  const fideMap = {};
  players.forEach(r => {
    const fideId = Number(r[1]);
    if (fideId) fideMap[fideId] = { name: r[2], mobile: r[0] };
  });

  Logger.log(`Players loaded: ${Object.keys(fideMap).length}`);

  const tournamentsSheet = ss.getSheetByName("tournaments");
  const tournaments = tournamentsSheet.getDataRange().getValues();
  tournaments.shift();

  Logger.log(`Tournaments loaded: ${tournaments.length}`);

  const achievements =
    ss.getSheetByName("Student achievements") ||
    ss.insertSheet("Student achievements");

  const upcoming =
    ss.getSheetByName("Upcoming - Tournaments") ||
    ss.insertSheet("Upcoming - Tournaments");

  const headers = [
    "Created Time",
    "Name","FIDE ID","Mobile","Tournament","Chess-Results URL","Rated",
    "Start Date","End Date",
    "Starting Rank","Rating","Rating Int","Performance",
    "FIDE rtg +/-","Points","Final Rank","Federation","Year of Birth"
  ];

  achievements.clearContents().appendRow(headers);
  upcoming.clearContents().appendRow(headers);

  let achievementCount = 0;
  let upcomingCount = 0;

  tournaments.forEach(t => {
    const tournamentName = t[0];
    const baseUrl = t[1];
    const dbkey = t[2];
    const rated = t[5];

    if (!baseUrl || !dbkey) {
      Logger.log(`Skipping tournament (missing URL/DBKEY): ${tournamentName}`);
      return;
    }

    Logger.log(`Processing tournament: ${tournamentName}`);

    const rawStartDate = new Date(t[6]);
    const rawEndDate = new Date(t[7]);

    const startDateStr = !isNaN(rawStartDate)
      ? Utilities.formatDate(rawStartDate, tz, "dd-MMM-yyyy")
      : "";

    const endDateStr = !isNaN(rawEndDate)
      ? Utilities.formatDate(rawEndDate, tz, "dd-MMM-yyyy")
      : "";

    const tableHtml = UrlFetchApp.fetch(baseUrl).getContentText();
    const rows = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    if (!rows) {
      Logger.log(`⚠️ No table rows for ${tournamentName}`);
      return;
    }

    rows.forEach(row => {
      const cells = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let m;
      while ((m = tdRegex.exec(row)) !== null) {
        cells.push(m[1].replace(/<[^>]+>/g, "").trim());
      }

      let fideId = null;
      cells.forEach(c => {
        const n = Number(c);
        if (fideMap[n]) fideId = n;
      });
      if (!fideId) return;

      const startingRank = Number(cells[0]);
      if (!startingRank) return;

      Logger.log(`→ Player found: ${fideMap[fideId].name} (${fideId})`);

      const playerUrl =
        `https://s3.chess-results.com/tnr${dbkey}.aspx?lan=1&art=9&snr=${startingRank}&SNode=S0`;

      const html = UrlFetchApp.fetch(playerUrl).getContentText();
      const detailRows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      if (!detailRows) return;

      const data = {};
      detailRows.forEach(r => {
        const tds = r.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
        if (tds && tds.length === 2) {
          const k = tds[0].replace(/<[^>]+>/g,"").trim();
          const v = tds[1].replace(/<[^>]+>/g,"").trim();
          data[k] = v;
        }
      });

      const rowData = [
        now,
        data["Name"] || fideMap[fideId].name,
        fideId,
        fideMap[fideId].mobile,
        tournamentName,
        baseUrl,
        rated,
        startDateStr,
        endDateStr,
        data["Starting rank"] || "",
        data["Rating"] || "",
        data["Rating international"] || "",
        data["Performance rating"] || "",
        data["FIDE rtg +/-"] || "",
        data["Points"] || "",
        data["Rank"] || "",
        data["Federation"] || "",
        data["Year of birth"] || ""
      ];

      achievements.appendRow(rowData);
      achievementCount++;

      if (!isNaN(rawStartDate) && rawStartDate > today) {
        upcoming.appendRow(rowData);
        upcomingCount++;
      }
    });
  });

  Logger.log(`✔ Achievements rows written: ${achievementCount}`);
  Logger.log(`✔ Upcoming tournament rows written: ${upcomingCount}`);
  Logger.log("===== END: fetchChessResultsPlayerDetailsByFide =====");
}



/***********************
 * CUSTOM MENU
 ***********************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("♟ Chess Tools")
    .addItem("Fetch Tournament Results", "fetchChessResultsPlayerDetailsByFide")
    .addSeparator()
    .addItem("Fetch FIDE Ratings", "fetchFideRatings")
    .addToUi();
}

function fetchFideRatings2026() {

  Logger.log("===== START fetchFideRatings2026 =====");

  const ss = SpreadsheetApp.getActive();
  const sourceSheet = ss.getSheetByName("players");
  const now = new Date();

  const ratingSheet =
    ss.getSheetByName("rating_change_2026") || ss.insertSheet("rating_change_2026");

  const gotSheet =
    ss.getSheetByName("Got_rating_2026") || ss.insertSheet("Got_rating_2026");

  ratingSheet.clearContents();
  gotSheet.clearContents();

  ratingSheet.appendRow([
    "Created Time",
    "Month",
    "Player Name","Mobile","FIDE ID",
    "Standard","Standard Δ",
    "Rapid","Rapid Δ",
    "Blitz","Blitz Δ"
  ]);

  gotSheet.appendRow([
    "Created Time",
    "Month",
    "Player Name","Mobile","FIDE ID",
    "Standard","Rapid","Blitz"
  ]);

  const data = sourceSheet.getDataRange().getValues();
  data.shift();

  // Months exactly as API returns
  const allowedMonths = ["2026-Jan","2026-Feb","2026-Mar"];

  data.forEach(row => {

    const mobile = row[0];
    const fideId = row[1];
    const name = row[2];

    if (!fideId) return;

    const url = `https://api.chesstools.org/fide/player_history/?fide_id=${fideId}`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    if (res.getResponseCode() !== 200) return;

    const history = JSON.parse(res.getContentText());
    if (!history || history.length === 0) return;

    history.sort((a,b)=> new Date(a.date + "-01") - new Date(b.date + "-01"));

    for (let i = 0; i < history.length; i++) {

      const cur = history[i];
      const prev = history[i-1] || {};

      if (!allowedMonths.includes(cur.period)) continue;

      const std = cur.classical_rating || 0;
      const rap = cur.rapid_rating || 0;
      const bli = cur.blitz_rating || 0;

      const prevStd = prev.classical_rating || 0;
      const prevRap = prev.rapid_rating || 0;
      const prevBli = prev.blitz_rating || 0;

      ratingSheet.appendRow([
        now,
        cur.period,
        name,mobile,fideId,
        std, std - prevStd,
        rap, rap - prevRap,
        bli, bli - prevBli
      ]);

      const gotStd = prevStd === 0 && std > 0;
      const gotRap = prevRap === 0 && rap > 0;
      const gotBli = prevBli === 0 && bli > 0;

      if (gotStd || gotRap || gotBli) {

        gotSheet.appendRow([
          now,
          cur.period,
          name,mobile,fideId,
          gotStd ? std : "",
          gotRap ? rap : "",
          gotBli ? bli : ""
        ]);

      }

    }

  });

  Logger.log("===== END fetchFideRatings2026 =====");

}