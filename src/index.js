// To dos:
// - Refactor CODA API calls into a single function
// - Better error handling
// - Verify webhook is coming from Coda
// - Automatically grab the columns from the task table and allow user to which columns they want to use

const Fuse = require('fuse.js')
const OpenAI = require('openai')

const codaEP = 'https://coda.io/apis/v1'
const delimiter = '-'

// Near the top of the file, let's add a constant for our statuses
// const TASK_STATUSES = {
//   INBOX: '📥 Inbox',
//   BACKLOG: '🥶 Backlog',
//   THIS_WEEK: '📅 This Week',
//   TODAY: '⭐️ Today',
//   WAITING: '⌛ Waiting',
//   COMPLETED: '✅ Completed',
// }

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

// Add new function to fetch task statuses
const returnTaskStatuses = async (env) => {
  const CODA_API_KEY = env.CODA_API_KEY
  const docId = env.DOC_ID
  const statusTableId = env.STATUS_TABLE_ID

  const url = `${codaEP}/docs/${docId}/tables/${statusTableId}/rows`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${CODA_API_KEY}`,
  }

  const init = {
    method: 'GET',
    headers: headers,
  }

  try {
    const response = await fetch(url, init)
    const rj = await response.json()
    console.log('Raw status response:', rj)

    // Sort by Order column and create a map of status names
    const statuses = rj.items
      .sort(
        (a, b) =>
          a.values[env.STATUS_ORDER_COLUMN_ID] -
          b.values[env.STATUS_ORDER_COLUMN_ID]
      )
      .reduce((acc, item) => {
        // Use the name field directly since it contains the status with emoji
        const statusName = item.name

        // Convert status name to uppercase key without emojis and special characters
        const key = statusName
          .replace(/[^\w\s]/g, '')
          .trim()
          .toUpperCase()
          .replace(/\s+/g, '_')
        acc[key] = statusName
        return acc
      }, {})

    console.log('Processed statuses:', statuses)
    return statuses
  } catch (e) {
    console.log('Error fetching statuses:', e)
    // Return a basic status object as fallback
    return {
      INBOX: '📥 Inbox',
    }
  }
}

// Function to fetch sub-categories
const returnSubCategories = async (env) => {
  const url = `${codaEP}/docs/${env.DOC_ID}/tables/${env.SUB_CATEGORIES_TABLE_ID}/rows`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.CODA_API_KEY}`,
  }

  try {
    const response = await fetch(url, { headers })
    const rj = await response.json()
    console.log('Raw sub-categories response:', rj)

    const categories = rj.items.map((item) => ({
      name: item.name,
      id: item.id,
    }))
    console.log('Processed sub-categories:', categories)
    return categories
  } catch (e) {
    console.log('Error fetching sub-categories:', e)
    return []
  }
}

// Function to determine category using AI
const determineCategory = async (taskDescription, subCategories, env) => {
  const AI_GATEWAY_ENDPOINT = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/openai`

  if (!subCategories.length) {
    console.log('No categories available')
    return { name: ' Uncategorized', id: 'fallback' }
  }

  const openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: AI_GATEWAY_ENDPOINT,
  })

  try {
    const prompt = `Task: "${taskDescription}"

Available categories:
${subCategories.map((cat) => cat.name).join('\n')}

Select the most appropriate category for this task from the list above. Reply with ONLY the exact category name, including emoji. If no category fits well, reply with " Uncategorized".`

    console.log('Sending prompt to AI:', prompt)

    const chatCompletion = await openai.chat.completions.create({
      model: env.AI_MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 50,
      temperature: 0.3,
    })

    const suggestedCategory = chatCompletion.choices[0].message.content.trim()
    console.log('AI suggested category:', suggestedCategory)

    // Find exact match from the AI's suggestion
    const matchedCategory = subCategories.find(
      (cat) => cat.name === suggestedCategory
    )
    console.log('Matched category:', matchedCategory)

    // Find Uncategorized for fallback
    const uncategorized = subCategories.find((cat) =>
      cat.name.trim().toLowerCase().includes('uncategorized')
    )

    return (
      matchedCategory ||
      uncategorized || { name: ' Uncategorized', id: 'fallback' }
    )
  } catch (e) {
    console.log('Error determining category:', e)
    const uncategorized = subCategories.find((cat) =>
      cat.name.trim().toLowerCase().includes('uncategorized')
    )
    return uncategorized || { name: ' Uncategorized', id: 'fallback' }
  }
}

// Add a new function for duration estimation
const estimateTaskDuration = async (taskDescription, env) => {
  const AI_GATEWAY_ENDPOINT = `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/openai`

  const openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: AI_GATEWAY_ENDPOINT,
  })

  try {
    const prompt = `Task: "${taskDescription}"

Estimate how long this task will take. Maximum duration is 2 hours.
Reply with ONLY the duration in one of these formats:
- "15 mins" for quick tasks
- "30 mins" for medium tasks
- "1 hr" for longer tasks
- "1 hr 30 mins" for complex tasks
- "2 hr" for very complex tasks

Guidelines:
- Most simple tasks should be 15 mins
- Never exceed 2 hours
- Use 15 min increments only (15, 30, 45 mins)
- For tasks that might take longer than 2 hours, just return "2 hr"`

    console.log('Sending duration prompt to AI:', prompt)

    const chatCompletion = await openai.chat.completions.create({
      model: env.AI_MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 50,
      temperature: 0.3,
    })

    const estimatedDuration = chatCompletion.choices[0].message.content.trim()

    // Validate the response format and cap at 2 hours
    const durationRegex = /^((\d+)\s*mins?|(\d+)\s*hr(\s+(\d+)\s*mins?)?)$/i
    if (!durationRegex.test(estimatedDuration)) {
      console.log(
        'Invalid duration format, falling back to default:',
        estimatedDuration
      )
      return '15 mins'
    }

    // Parse the duration and ensure it doesn't exceed 2 hours
    const hrMatch = estimatedDuration.match(/(\d+)\s*hr/i)
    const minsMatch = estimatedDuration.match(/(\d+)\s*mins?/i)

    const hours = hrMatch ? parseInt(hrMatch[1]) : 0
    const mins = minsMatch ? parseInt(minsMatch[1]) : 0
    const totalMins = hours * 60 + mins

    if (totalMins > 120) {
      console.log(
        'Duration exceeds 2 hours, capping at 2 hr:',
        estimatedDuration
      )
      return '2 hr'
    }

    console.log('AI estimated duration:', estimatedDuration)
    return estimatedDuration
  } catch (e) {
    console.log('Error estimating duration:', e)
    return '15 mins' // Default fallback
  }
}

// Modify generateCodaData to include duration estimation
const generateCodaData = async (message, env) => {
  const simple = !message.includes(delimiter) || message.includes('://')
  const taskStatuses = await returnTaskStatuses(env)
  const subCategories = await returnSubCategories(env)

  console.log('Incoming text:', message, 'simple:', simple)

  let data = { rows: [{ cells: [] }] }

  function Cell(columnName, column, value) {
    this.column = column
    this.value = value
  }

  // Get category and duration estimates
  const taskCategory = await determineCategory(
    simple ? message : parseText(message).taskText,
    subCategories,
    env
  )

  const duration = simple
    ? await estimateTaskDuration(message, env)
    : parsedText.taskTime ||
      (await estimateTaskDuration(parsedText.taskText, env))

  console.log('Selected task category:', taskCategory)
  console.log('Estimated duration:', duration)

  if (simple) {
    data.rows[0].cells.push(
      new Cell('Task Name', env.TASK_NAME_COLUMN_ID, message)
    )
    data.rows[0].cells.push(
      new Cell('Task Status', env.TASK_STATUS_COLUMN_ID, taskStatuses.INBOX)
    )
    data.rows[0].cells.push(
      new Cell('Sub Category', env.SUB_CATEGORY_COLUMN_ID, taskCategory.id)
    )
    data.rows[0].cells.push(
      new Cell('Predicted Duration', env.PREDICTED_DURATION_COLUMN_ID, duration)
    )
  } else {
    const parsedText = parseText(message)

    data.rows[0].cells.push(
      new Cell('Task Name', env.TASK_NAME_COLUMN_ID, parsedText.taskText)
    )
    data.rows[0].cells.push(
      new Cell('Task Status', env.TASK_STATUS_COLUMN_ID, taskStatuses.INBOX)
    )
    data.rows[0].cells.push(
      new Cell('Sub Category', env.SUB_CATEGORY_COLUMN_ID, taskCategory.id)
    )
    data.rows[0].cells.push(
      new Cell('Predicted Duration', env.PREDICTED_DURATION_COLUMN_ID, duration)
    )
  }

  console.log('Full generated data:', JSON.stringify(data, null, 2))
  return data
}

const addCodaTodo = async (message, env) => {
  const CODA_API_KEY = env.CODA_API_KEY
  const docId = env.DOC_ID
  const taskTableId = env.TASK_TABLE_ID

  const data = await generateCodaData(message, env)
  console.log(JSON.stringify(data))

  const url = `${codaEP}/docs/${docId}/tables/${taskTableId}/rows`
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + CODA_API_KEY,
  }

  const init = {
    body: JSON.stringify(data),
    method: 'POST',
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

export default {
  async fetch(request, env) {
    // Parse allowed phone numbers from env variable (comma-separated string)
    const ALLOWED_PHONES = env.OUTBOUND_PHONE.split(',').map((num) =>
      num.trim()
    )

    if (request.method != 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
      })
    }

    const data = await request.text()
    const params = new URLSearchParams(data)
    const twilioObject = Object.fromEntries(params.entries())
    const fromNumber = twilioObject.From

    // Check if the incoming number is in the allowed numbers array
    if (!ALLOWED_PHONES.includes(fromNumber)) {
      return new Response('Forbidden', {
        status: 403,
      })
    }

    const message = twilioObject.Body

    const response = await addCodaTodo(message, env)
    console.log(JSON.stringify(response))

    return new Response('Item successfully added!')
  },
}
