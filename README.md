# Text to Coda
## Background
I love Coda, but sometimes I just need to add a quick thought or new todo item to one of my projects and at times, Coda can take a prohibitively long to open and become reactive.

Now, I can just text anything to my Twilio number and have it show up in my task management system, complete with AI-powered categorization, duration estimates, and smart date parsing.

## Features
- 🤖 AI-powered task categorization
- ⏱️ Automatic duration estimation (15 mins to 2 hours)
- 📅 Natural language date parsing (e.g., "tomorrow", "next week")
- ⚡ Shortcuts for quick task status setting
- 🔒 Webhook verification and rate limiting
- 📊 Built-in metrics and logging

## Shortcuts
Add these anywhere in your message:
- `!urgent` - Sets task to "Today"
- `!later` - Moves to "Backlog"
- `!week` - Sets to "This Week"
- `!wait` - Marks as "Waiting"

## Date Recognition
The system understands a wide variety of date formats and expressions:

Natural Language:
- "today", "tomorrow", "tonight"
- "next Monday", "this Friday"
- "in 3 days", "in two weeks"
- "end of week", "beginning of next month"
- "next Tuesday at 3pm"

Specific Dates:
- "Jan 15"
- "2024-01-20"
- "01/15/24"

Time Specifications:
- "3pm tomorrow"
- "next week at 2:30pm"
- "Friday morning"

## Getting Started

### Sign up for Cloudflare 
1. Go to https://dash.cloudflare.com/sign-up/workers and sign up for a free Cloudflare account
2. Create an API token at https://dash.cloudflare.com/profile/api-tokens using the "Edit Cloudflare Workers" template
3. Store the API key safely for later use

### Install Wrangler CLI
1. Install Wrangler CLI: `npm install -g wrangler`
2. Authenticate: `wrangler login`
3. Clone this repo and run `npm install`

### Twilio Setup
1. Sign up for Twilio and get a phone number
2. Save your Twilio Auth Token from the account dashboard

### Coda Setup
1. Generate a Coda API Key from Account Settings
2. Get your Doc ID from the URL or API helper tool
3. Create or identify these tables and copy their IDs:
   - Main Tasks table
   - Task Statuses table
   - Task Sub-categories table
   - Task Categories table (optional)
   - Work Modes table (optional)

### Configuration
1. Update `wrangler.toml` with your:
   - Document ID
   - Table IDs
   - Column IDs
   - AI Gateway configuration

2. Set required secrets using `wrangler secret put`:
   ```bash
   wrangler secret put CODA_API_KEY
   wrangler secret put OUTBOUND_PHONE
   wrangler secret put TWILIO_AUTH_TOKEN
   wrangler secret put OPENAI_API_KEY
   ```

3. Deploy your worker:
   ```bash
   wrangler publish
   ```

### Setup Twilio Webhook
1. Go to Phone Numbers > Active Numbers in Twilio console
2. Set your worker URL as the webhook for incoming messages (POST)

## Usage Examples

Simple task with due date:

