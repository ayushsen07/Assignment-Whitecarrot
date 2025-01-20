
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');

const app = express();

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.readonly']
  },
  (accessToken, refreshToken, profile, done) => {
    return done(null, { ...profile, accessToken });
  }
));

// Routes
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html');
});

app.get('/auth/google',
  passport.authenticate('google')
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/events')
);

app.get('/events', async (req, res) => {
  if (!req.user) {
    return res.redirect('/');
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: req.user.accessToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  
  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items;
    res.sendFile(__dirname + '/views/events.html');
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).send('Error fetching calendar events');
  }
});

app.get('/api/events', async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  
    const filterDate = req.query.date; // Get filter date from query parameter
  
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: req.user.accessToken });
  
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    try {
      let timeMin = new Date().toISOString();
      if (filterDate) {
        // If filter date is provided, set timeMin to start of that day
        timeMin = new Date(filterDate);
        timeMin.setHours(0, 0, 0, 0);
        timeMin = timeMin.toISOString();
      }
  
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin,
        timeMax: filterDate ? new Date(new Date(filterDate).setHours(23, 59, 59, 999)).toISOString() : undefined,
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
      });
  
      const events = response.data.items.map(event => ({
        name: event.summary,
        date: event.start.dateTime || event.start.date,
        time: event.start.dateTime ? new Date(event.start.dateTime).toLocaleTimeString() : 'All day',
        location: event.location || 'No location specified'
      }));
  
      res.json(events);
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      res.status(500).json({ error: 'Error fetching calendar events' });
    }
  });

app.listen(2000, () => {
  console.log('Server running on http://localhost:2000');
});
