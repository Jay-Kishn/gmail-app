const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');


// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

//get a list of emails
async function listEmailThreads(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
  
    const threadsRes = await gmail.users.threads.list({
      userId: 'me',
      maxResults:2
    });
  
    return threadsRes.data.threads || [];
  }
  

  function hasSentEmailInThread(thread, emailAddress) {
    if (thread.data.messages && thread.data.messages.length > 0) {
      const participants = [];
  
      for (const message of thread.data.messages) {
        for (const header of message.payload.headers) { //iterate through headers to find the sender IDs 
          if (header.name === 'From') {
            const matching = header.value.match(/<([^>]+)>/); // regex to extract the email address inside <>
            participants.push(matching ? matching[1] : header.value); //if mail found in <> add, else add whole value
          }
        }
      }
  
      if (participants.includes(emailAddress)) {
        console.log("Has replied");
        return true;
      }
    }
  
    console.log("Has not replied");
    return false;
  }
  
  
  
  async function identifyThreadsWithoutPriorEmail(auth, emailAddress) {
    const gmail = google.gmail({ version: 'v1', auth });
    
    //  Get all threads
    const allThreads = await listEmailThreads(auth);
  
    // Identify threads without prior emails
    const threadsWithoutPriorEmail = [];
  
    for (const thread of allThreads) {
      try {
        const response = await gmail.users.threads.get({
          userId: 'me',
          id: thread.id,
        });
  
        //  Check if the thread has no prior emails sent by the user
        if (!hasSentEmailInThread(response, emailAddress)) {
          threadsWithoutPriorEmail.push(thread);
        }
      } catch (error) {
        console.error('Error fetching thread details:', error.message);
      }
    }
  
    return threadsWithoutPriorEmail; //contains all threads where user has sent no message
  }
  

  async function replyAndAddLabelToThreads(auth, threads) {
    const gmail = google.gmail({ version: 'v1', auth });
  
    for (const thread of threads) {
      // Check if the thread has messages
      
        const response = await gmail.users.threads.get({
        userId: 'me',
        id: thread.id
        });

        //console.log(response.data.messages[0].payload.headers)

      if (response.data.messages && response.data.messages.length > 0) {

        // reply by getting the original sender's email from the first message in the thread
        const originalSender = response.data.messages[0].payload.headers.find(header => header.name === 'From').value;

        //console.log(originalSender)
  
        // reply to the thread
        const base64Reply = Buffer.from(
          `To: ${originalSender}\r\n` +
          'Content-type: text/html;charset=iso-8859-1\r\n' +
          'MIME-Version: 1.0\r\n' +
          '\r\n' +
          'Im vacationing in Hawai Habibi!!!!'
        ).toString('base64');
  
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            threadId: thread.id,
            raw: base64Reply,
          },
        });
  
        // Add the label to the thread
        // first step is to retrieve the existing list of labels
  const labelsResponse = await gmail.users.labels.list({ userId: 'me' });
  const labels = labelsResponse.data.labels;
  const labelName = 'onLeave' //set a label name

  //  check if the label exists
  const existingLabel = labels.find(label => label.name === labelName);

  let labelId;

  //  if the label doesn't exist, create it
  if (!existingLabel) {
    const createLabelResponse = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        messageListVisibility: 'show',
        labelListVisibility: 'labelShow',
      },
    });

   // console.log(`Label '${labelName}' created. Res`, createLabelResponse.data);
    labelId = createLabelResponse.data.id;
  } else {
    // Label already exists, use its ID
    labelId = existingLabel.id;
  }

  //  Modify thread by adding the label
  await gmail.users.threads.modify({
    userId: 'me',
    id: thread.id,
    requestBody: {
      addLabelIds: [labelId],
    },
  });

  console.log(`Thread ${thread.id} modified with label ID '${labelId}'.`);

      } else {
        console.error(`Thread ${thread.id} has no messages.`);
        //console.log(thread)
      }
    }
  }
  
  async function identifyAndReplyToAddLabel(auth) {
    const emailAddress = 'darshalsamith@gmail.com'
    try {
      const threadsWithoutPriorEmail = await identifyThreadsWithoutPriorEmail(auth, emailAddress);

      if (threadsWithoutPriorEmail.length > 0) {
       // console.log('Threads without prior email:', threadsWithoutPriorEmail);
        
        // Reply to threads and add label
        await replyAndAddLabelToThreads(auth, threadsWithoutPriorEmail);
        
       // console.log('Replied to threads and added the label.');
      } else {
        //console.log('No threads found without prior email sent by you.');
      }
    } catch (error) {
      console.error('Error:', error.message);
    }
  }


//authorize().then(identifyAndReplyToAddLabel).catch(console.error);

function getRandomInterval(minSeconds, maxSeconds) {
    // Generate a random number between minSeconds and maxSeconds
    return Math.floor(Math.random() * (maxSeconds - minSeconds + 1) + minSeconds) * 1000; // Convert to milliseconds
  }
  
  function runIdentifyAndReplyToAddLabel() {
    authorize()
      .then(identifyAndReplyToAddLabel)
      .catch(console.error)
      .finally(() => {
        // Schedule the next run after a random interval
        const nextInterval = getRandomInterval(10,20);
        setTimeout(runIdentifyAndReplyToAddLabel, nextInterval);
      });
  }
  
// Start the process
runIdentifyAndReplyToAddLabel();
  

  