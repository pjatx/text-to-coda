// To dos:
// - Refactor CODA API calls into a single function
// - Better error handling
// - Verify webhook is coming from Coda
// - Automatically grab the columns from the task table and allow user to which columns they want to use

const Fuse = require('fuse.js')

const codaEP = 'https://coda.io/apis/v1'
const delimiter = '-'

// Parse message into it its components using a '-' delimiter
const parseText = (text) => {
  const textArray = text.split('-')
  const parsedText = {
    taskType: textArray[0].trim(),
    taskTime: textArray[1].trim(),
    taskText: textArray[2].trim(),
  }

  return parsedText
}

// Fuzzy search for task type from existing task type table in coda and return the best match
const determineTaskType = (taskTypes, searchString) => {
  const options = {
    includeScore: true,
    keys: ['taskTypes.name'],
  }

  const fuse = new Fuse(taskTypes, options)
  const result = fuse.search(searchString)
  const bestMatch = result.sort((a, b) => a.score - b.score)[0]
  return bestMatch ? bestMatch.item : null
}

const codaApiCall = async (url, method, headers, body = null) => {
  const init = {
    method: method,
    headers: headers,
  }

  if (body) {
    init.body = JSON.stringify(body)
  }

  try {
    const response = await fetch(url, init)
    return await response.json()
  } catch (e) {
    throw new Error('Oops! Something went wrong. Please try again later.')
  }
}

const returnTaskTypes = async (env) => {
  const CODA_API_KEY = env.CODA_API_KEY
  const docId = env.DOC_ID
  const typesTableId = env.TYPES_TABLE_ID

  const url = `${codaEP}/docs/${docId}/tables/${typesTableId}/rows`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.CODA_API_KEY}`,
  }

  const init = {
    method: 'GET',
    headers: headers,
  }

  try {
    const response = await fetch(url, init)
    const rj = await response.json()
    return rj
  } catch (e) {
    console.log(e)
    return new Response('Oops! Something went wrong. Please try again later.')
  }
}

const generateCodaData = async (message, env) => {
  const simple = !message.includes(delimiter) || message.includes('://')

  let data = { rows: [{ cells: [] }] }

  function Cell(columnName, column, value) {
    this.column = column
    this.value = value
  }

  if (simple) {
    data.rows[0].cells.push(new Cell('Task Name', 'c-70z9tdOF3c', message))
    data.rows[0].cells.push(new Cell('Task Status', 'c-kN87N8b6Gr', 'Today'))
  } else {
    const taskTypeTable = await returnTaskTypes(env)
    const taskTypes = taskTypeTable.items.map((item) => item.name)
    const parsedText = parseText(message)
    const taskTypeMatch = determineTaskType(taskTypes, parsedText.taskType)

    if (!taskTypeMatch) {
      throw new Error("Sorry, I don't know that task type. Please try again!")
    }

    data.rows[0].cells.push(
      new Cell('Task Name', 'c-70z9tdOF3c', parsedText.taskText)
    )
    data.rows[0].cells.push(new Cell('Task Status', 'c-kN87N8b6Gr', 'Backlog'))
    data.rows[0].cells.push(
      new Cell('Task Type', 'c-eDVIqu2xj_', taskTypeMatch)
    )
    data.rows[0].cells.push(
      new Cell('Predicted Duration', 'c-L4lltHxi-h', parsedText.taskTime)
    )
    data.rows[0].cells.push(new Cell('Needs Triage', 'c-2alHSrothg', true))
  }
  return data
}

const addCodaTodo = async (message, env) => {
  const data = await generateCodaData(message, env)

  const url = `${codaEP}/docs/${env.DOC_ID}/tables/${env.TASK_TABLE_ID}/rows`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + env.CODA_API_KEY,
  }

  return await codaApiCall(url, 'POST', headers, data)
}

export default {
  async fetch(request, env) {
    if (request.method != 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
      })
    }

    const data = await request.text()
    const params = new URLSearchParams(data)
    const twilioObject = Object.fromEntries(params.entries())

    if (twilioObject.From != env.OUTBOUND_PHONE) {
      return new Response('Forbidden', {
        status: 403,
      })
    }

    try {
      const response = await addCodaTodo(twilioObject.Body, env)
      return new Response('Item successfully added!')
    } catch (error) {
      return new Response(error.message, {
        status: 500,
      })
    }
  },
}
