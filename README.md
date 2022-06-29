# Text to Coda
## Background
I love Coda, but sometimes I just need to add a quick thought or new todo item to one of my projects and at times, Coda can take a prohibitively long to open and become reactive.

Now, I can just text anything to my Twilio number and have it show up. 

## Getting Started

### Sign up for Cloudflare 
1. Go to https://dash.cloudflare.com/sign-up/workers and sign up for a free Cloudflare account. This is super quick and will allow you to run a free serverless function at the edge that will consume a Twilio webhook and integrate with Coda. 
1. Grab a Cloudflare API key by navigating here: https://dash.cloudflare.com/profile/api-tokens. Click "Create Token," then choose the "Edit Cloudflare Workers" template. Make sure you select the appropriate account resource to the account you just created or choose "All Accounts."
1. Store that API key somewhere safe - we'll be using it in a future step.

### Install Wrangler CLI to Interact with Your Worker
1. Install Wrangler CLI by following the instructions here: https://developers.cloudflare.com/workers/wrangler/get-started/
1. Once you're authenticated, clone this repo into a local directory and run `npm install`.

### Sign up for Twilio and Grab a Number
1. Now, you need a Twilio account. Sign up for Twilio and get a new number. Save that number for later. 
1. Next, grab your Twilo "Auth Token." This should be somewhere on your account home screen.


### Generate a Coda API Key and grab your Doc and Table ID
1. Head over to Coda and generate an API Key from your Account Settings page. More information can be found in the docs: https://coda.io/developers/apis/v1#section/Introduction
1. Grab the Doc ID that contains the table you want to add a row to. There's a handy DOC ID extractor you can use here: https://coda.io/developers/apis/v1#section/Using-the-API/Resource-IDs-and-Links
1. Now grab your Table ID. You can find this by clicking the little eplises at the top of the table and select the "Copy Table ID" from the menu. 
1. Finally, if you'd like to add a category field to each row you're adding create a new table with all the categories you want to choose from and use that table ID for the `TYPES_TABLE_ID`


### Configure your wrangler.toml, set secrets, and publish worker
1. Find the `wrangler.toml` file and replace the doc and tables IDs with your own from the steps above. 
1. Set the secrets you'll need in Wrangler: 
    1. `CODA_API_KEY`
    2. `OUTBOUND_PHONE`
    3. `TWILIO_AUTH_TOKEN`
1. You can achieve this using the following command: `wrangler secret put <NAME>` - Wrangler will ask you for the value after you set the name. 
1. Publish your Worker by running `wrangler publish`
1. It should output the url of your worker in the command line. 


### Setup an SMS webhook in Twilio
1. Navigate to the "Phone Numbers" product. It's a bit hard to find, but you can get there by navigating here https://console.twilio.com/develop/explore and then selecting "Phone Numbers" within the Super Network section. 
1. Go to the "Active Numbers" page and add your worker URL as a webhook destination in the messaging section for when "A Message Comes In". Make sure you set it as a https POST request.

### Customize
Edit the column ids and values in `index.js` to match your column ids and values of choice.

### Try it out
Send any text to your Twilio number and you should get back a `Item successfully added!` reply if everything is working correctly. 

### Advanced messages using a delimiter
I've also added a bit of logic where you can use a delimiter to send a three part message.
- Part 1: Task Category / Type
- Part 2: Expected time needed to complete task (I have a dedicated column for this)
- Part 3: Task Name

You can set your desired delimiter by changing the `delimiter` variable at the top of the file. If you include at least 1 delmiter in your text, it will attempt to parse the message into different columns. If not, it will simply use the task name.

### Debug
If it's not working, you can always run `wrangler tail` to see the log outputs of your worker. You can also run `wrangler dev` locally, run a n NGROK tunnel or something similar, and update your webhook destination URL to the NGROK url for local debugging. 

## To Dos
* Ensure Webhooks are actually coming from Twilio and not somewhere else
* Add some syntax logic to allow for posting to different tables / setting different column values depending on the contents of the message.

