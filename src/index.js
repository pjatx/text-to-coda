const Fuse = require('fuse.js')

const codaEP = 'https://coda.io/apis/v1'

// Parse message into it its components using a '-' delimiter
const parseText = (text) => {
  const textArray = text.split('-')
  const parsedText = {
    taskType: textArray[0].trim(),
    taskTime: textArray[1].trim(),
    taskText: textArray[2].trim()
  }

  return parsedText
}

// Fuzzy search for task type from existing task type table in coda and return the best match
const determineTaskType = (taskTypes, searchString) => {
  const options = {
    includeScore: true,
    keys: ['taskTypes.name']
  }

  const fuse = new Fuse(taskTypes, options)
  const result = fuse.search(searchString)
  const bestMatch = result.sort((a, b) => a.score - b.score)[0]
  console.log(JSON.stringify(bestMatch))
  return bestMatch ? bestMatch.item : null
}

const returnTaskTypes = async (env) => {
  const CODA_API_KEY = env.CODA_API_KEY
  const docId = env.DOC_ID
  const typesTableId = env.TYPES_TABLE_ID

  const url = `${codaEP}/docs/${docId}/tables/${typesTableId}/rows`
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.CODA_API_KEY}`
  }

  const init = {
    method: 'GET',
    headers: headers,
  }

  try {
    const response = await fetch(url, init);
    const rj = await response.json()
    return rj
  } catch (e) {
    console.log(e)
    return new Response("Oops! Something went wrong. Please try again later.")
  }
}

const addCodaTodo = async (text, env) => {
  const CODA_API_KEY = env.CODA_API_KEY
  const docId = env.DOC_ID
  const taskTableId = env.TASK_TABLE_ID

  const taskTypeTable = await returnTaskTypes(env)
  const taskTypes = taskTypeTable.items.map(item => item.name)

  const parsedText = parseText(text)

  const taskTypeMatch = determineTaskType(taskTypes, parsedText.taskType)
  console.log(taskTypeMatch)
  if (!taskTypeMatch) {
    return new Response("Sorry, I don't know that task type. Please try again.")
  }

  let data = {
    'rows': [
      {
        'cells': [
          {
            // Task Name
            'column': 'c-70z9tdOF3c',
            'value': parsedText.taskText
          },
          {
            // Task Status
            'column': 'c-kN87N8b6Gr',
            'value': 'Backlog'
          },
          // Task Category
          {
            'column': 'c-eDVIqu2xj_',
            'value': taskTypeMatch
          },
          // Predicted Duration
          {
            'column': 'c-L4lltHxi-h',
            'value': parsedText.taskTime
          },
        ]
      }
    ]
  }  

  console.log(data)

  const url = `${codaEP}/docs/${docId}/tables/${taskTableId}/rows`
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + CODA_API_KEY
  }

  const init = {
    body: JSON.stringify(data),
    method: 'POST',
    headers: headers,
  }

  try {
    const response = await fetch(url, init);
    const rj = await response.json()
    console.log(rj)
    return rj
  } catch (e) {
    console.log(e)
    return new Response("Oops! Something went wrong. Please try again later.")
  }
}

export default {
  async fetch(request, env) {
    const OUTBOUND_PHONE = env.OUTBOUND_PHONE
    
    if (request.method != 'POST') {
      return new Response("Method Not Allowed", {
        status: 405
      })
    }

    // Get body of the request - will be text since it's URL encoded
    const data = await request.text();

    // Decode URL
    const params = new URLSearchParams(data);
    // Get query params and put in a JS object
    const twilioObject = Object.fromEntries(params.entries());
    const fromNumber = twilioObject.From;

    // Only allow texts from the users number
    if (fromNumber != OUTBOUND_PHONE) {
      return new Response("Forbidden", {
        status: 403
      })
    }

    const message = twilioObject.Body;
    const response = await addCodaTodo(message, env)
    console.log(JSON.stringify(response))

    return new Response("Item successfully added!")
  },
};
