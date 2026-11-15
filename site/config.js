// Where the site reads its data from (GitHub). If you rename the repo, update both URLs.
// For a local preview, override with ?data=/path/ and ?players=/path/players.json in the URL.
window.MFC_CONFIG = {
  dataBase: 'https://raw.githubusercontent.com/akshKN/madras-fc-stats/data/',
  // Club badges. Lives on the main branch, so editing it on GitHub needs no Netlify deploy.
  playersUrl: 'https://raw.githubusercontent.com/akshKN/madras-fc-stats/main/players.json',
  timeZone: 'America/Chicago',
  clubName: 'Madras FC',
  pollEveryHours: 2,
};
