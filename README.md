# RedTrack V2

RedTrack V2 is an open-source, full-stack Reddit user analysis application. It allows you to search for a Reddit user and generates comprehensive visualizations, intelligence summaries, and text metrics without requiring official Reddit API credentials (it bypasses PRAW and standard OAuth by scraping public JSON endpoints).

## Key Features

1. **Profile Insights & Charts**: Automatically pulls down user posts, comments, and karma statistics, visualizing them with dynamic Chart.js graphs (Activity Heatmap, Subreddit Doughnut, Karma Timeline).
2. **Text Explorer**: Analyzes all historical comments to build a word frequency index. You can click on commonly used words to see the full context of how they were used. It includes an aggressive stop-words filter (for both English and Romanian) to strip out uninteresting filler verbs and conjunctions.
3. **Connections Graph (D3.js)**: A force-directed node graph that visualizes the network of people the target user replies to the most. Click on a connected node to open a modal that displays the exact comments that were exchanged between the two users.
4. **AI-Powered Intelligence**: Integrates directly with Google Gemini (via `gemini-2.5-flash`) to analyze the user's historical behavior and psychological footprint. Generates reports from two distinct perspectives:
   - **Intelligence Analyst**: Focuses on habits, potential locations, traits, and operational patterns.
   - **Defense Lawyer**: Paints the user in the best possible light, highlighting positive contributions, expertise, and community helpfulness.
5. **Background Monitoring**: You can select specific users to "Monitor." A Node.js background cron job will automatically refresh their profile data every few minutes.
6. **Smart SQLite Caching**: User data is strictly saved to a local `redtrack.db` SQLite file (powered by `sql.js`). To prevent overloading Reddit's API, RedTrack prioritizes fetching from the database first. If a user's data was extracted in the last 12 hours, the app pulls from the database instead of Reddit. Pagination from Reddit is limited to 5 pages (500 items max).
7. **Export to PDF**: Generate clean, paginated PDF reports of a user's activity directly from their profile.
8. **Admin Dashboard**: A securely password-protected view for the server admin to observe high-level DB stats and browse all historically searched/stored users in a unified table.

## Prerequisites

- **Node.js** v18 or higher (v18+ is required for the native `fetch` API).
- **NPM** (usually comes with Node.js).

## Setup & Installation

1. **Clone the repository** (or navigate to the project folder):
   ```bash
   cd red-track
   ```

2. **Install Node modules**:
   ```bash
   npm install
   ```

3. **Configure the Environment**:
   Ensure you have a `.env` file in the root directory. It should contain the following properties:
   ```env
   # The port the Express proxy will run on
   PORT=3000

   # Your Google Gemini API credentials
   AI_PROVIDER=gemini
   AI_API_KEY=your_gemini_api_key_here
   AI_MODEL=gemini-2.5-flash

   # Your secure password to access the /admin dashboard
   ADMIN_PASSWORD=redtrack123
   ```

## Running the Application

To start the server, simply run:
```bash
npm start
```

You should see output similar to this:
```
[DB] Loaded existing database from /path/to/redtrack.db
[DB] Tables ready
[Monitor] Scheduler started (checking every 5 minutes)

🔴 RedTrack V2 running at http://localhost:3000
   DB: /path/to/redtrack.db
   AI: gemini / gemini-2.5-flash
```

Once running, you can access the tools through your web browser:
- **Main App**: [http://localhost:3000](http://localhost:3000)
- **Admin Dashboard**: [http://localhost:3000/admin](http://localhost:3000/admin) (Use the `ADMIN_PASSWORD` defined in `.env` to log in).

## Project Structure

- `server.js`: The main Express server acting as a proxy, holding routing logic, the caching controller, and the admin API.
- `db.js`: Contains all SQLite interactions using WASM `sql.js`. It manages tables for `users`, `posts`, `comments`, `user_connections`, `monitored_users`, and `ai_analysis`.
- `app.js`: The frontend orchestrator. Connects the DOM to backend logic, drives search requests, handles modals, and coordinates data formatting.
- `analysis.js`: Data processing module holding logic for Text Explorer, formatting, calculating engagement/averages, and containing the `STOP_WORDS_SET`.
- `charts.js`: Renders graphs using Chart.js configurations.
- `graph.js`: Renders the D3.js connection network graph.
- `connections.js`: Backend logic that parses comment metadata to recursively construct the mapping of who a user replied to.
- `ai-analyzer.js`: Packages user data efficiently into a prompt and passes it to the Gemini REST endpoint.
- `index.html` & `style.css`: The sleek responsive, Material Design 3 interface of RedTrack.
- `admin.html`: The secure backend visualization dashboard interface.
