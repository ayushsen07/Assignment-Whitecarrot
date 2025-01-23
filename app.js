require("dotenv").config();
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { google } = require("googleapis");
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');

const app = express();

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Create User Schema and Model
const userSchema = new mongoose.Schema({
  googleId: { 
    type: String, 
    required: true, 
    unique: true
  },
  email: { 
    type: String, 
    required: true 
  },
  name: { 
    type: String,
    required: false
  },
  accessToken: String,
  refreshToken: String
}, { 
  timestamps: true
});

const User = mongoose.model('User', userSchema);

// Session middleware with MongoDB store
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      ttl: 24 * 60 * 60, // Session TTL (1 day)
      autoRemove: 'native'
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: 'https://myEvents.onrender.com/auth/google/callback',
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
      proxy: true
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log('Profile received:', {
          id: profile.id,
          email: profile.emails?.[0]?.value,
          name: profile.displayName
        });

        let user = await User.findOne({ googleId: profile.id });
        
        if (!user) {
          try {
            user = await User.create({
              googleId: profile.id,
              email: profile.emails?.[0]?.value || 'no-email',
              name: profile.displayName || 'Anonymous',
              accessToken,
              refreshToken
            });
          } catch (createError) {
            console.error('Error creating user:', createError);
            return done(createError, null);
          }
        } else {
          user.accessToken = accessToken;
          if (refreshToken) user.refreshToken = refreshToken;
          try {
            await user.save();
          } catch (saveError) {
            console.error('Error updating user:', saveError);
            return done(saveError, null);
          }
        }
        
        return done(null, user);
      } catch (err) {
        console.error('Strategy error:', err);
        return done(err, null);
      }
    }
  )
);

// Authentication middleware
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
}

// Routes
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/views/index.html");
});

app.get("/auth/google", (req, res, next) => {
  console.log("Starting Google auth...");
  passport.authenticate("google")(req, res, next);
});

app.get("/auth/google/callback", 
  (req, res, next) => {
    console.log("Received callback from Google");
    passport.authenticate("google", {
      failureRedirect: "/?error=auth_failed",
      successRedirect: "/events",
      failureFlash: true
    })(req, res, next);
  }
);

app.get("/events", isAuthenticated, async (req, res) => {
  res.sendFile(__dirname + "/views/events.html");
});

app.get('/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    req.session.destroy();
    res.redirect('/');
  });
});

app.get("/api/events", isAuthenticated, async (req, res) => {
  const filterDate = req.query.date;

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: req.user.accessToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    let timeMin = new Date().toISOString();
    if (filterDate) {
      timeMin = new Date(filterDate);
      timeMin.setHours(0, 0, 0, 0);
      timeMin = timeMin.toISOString();
    }

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: timeMin,
      timeMax: filterDate
        ? new Date(new Date(filterDate).setHours(23, 59, 59, 999)).toISOString()
        : undefined,
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items.map((event) => ({
      name: event.summary,
      date: event.start.dateTime || event.start.date,
      time: event.start.dateTime
        ? new Date(event.start.dateTime).toLocaleTimeString()
        : "All day",
      location: event.location || "No location specified",
    }));

    res.json(events);
  } catch (error) {
    console.error("Error fetching calendar events:", error);
    res.status(500).json({ error: "Error fetching calendar events" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Application error:', err);
  if (err.name === 'TokenError') {
    return res.redirect('/?error=auth_failed');
  }
  res.status(500).send('An error occurred');
});

const PORT = process.env.PORT || 2000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});