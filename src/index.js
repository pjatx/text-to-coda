// To dos:
// - Refactor CODA API calls into a single function
// - Better error handling
// - Verify webhook is coming from Coda
// - Automatically grab the columns from the task table and allow user to which columns they want to use

const Fuse = require('fuse.js')
const OpenAI = require('openai')
const crypto = require('crypto')
const chrono = require('chrono-node')

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

// First, let's modify generateCodaData to be simpler and more focused
const generateCodaData = async (processedTask, env) => {
  const taskStatuses = await returnTaskStatuses(env)
  const subCategories = await returnSubCategories(env)

  log('info', 'Processing task', { task: processedTask })

  let data = { rows: [{ cells: [] }] }

  function Cell(columnName, column, value) {
    this.column = column
    this.value = value
  }

  // Get AI-powered categorization and duration estimate
  const taskCategory = await determineCategory(
    processedTask.text,
    subCategories,
    env
  )
  const duration = await estimateTaskDuration(processedTask.text, env)

  // Build the cells array with all our data
  const cells = [
    // Required fields
    new Cell('Task Name', env.TASK_NAME_COLUMN_ID, processedTask.text),
    new Cell(
      'Task Status',
      env.TASK_STATUS_COLUMN_ID,
      processedTask.status || taskStatuses.INBOX
    ),
    new Cell('Sub Category', env.SUB_CATEGORY_COLUMN_ID, taskCategory.id),
    new Cell('Predicted Duration', env.PREDICTED_DURATION_COLUMN_ID, duration),
  ]

  // Optional fields based on processed task data
  if (processedTask.dueDate) {
    cells.push(
      new Cell('Due Date', env.DUE_DATE_COLUMN_ID, processedTask.dueDate)
    )
  }

  data.rows[0].cells = cells

  log('info', 'Generated Coda data', {
    category: taskCategory.name,
    status: processedTask.status || taskStatuses.INBOX,
    duration,
    dueDate: processedTask.dueDate,
  })

  return data
}

// Then modify addCodaTodo to handle the processed task
const addCodaTodo = async (message, env) => {
  let data
  try {
    // Process the message for shortcuts and dates
    const processedTask = processTaskText(message)
    log('info', 'Processed message', { processedTask })

    // Generate the Coda data
    data = await generateCodaData(processedTask, env)
    
    log('info', 'Sending to Coda', { 
      url: `${codaEP}/docs/${env.DOC_ID}/tables/${env.TASK_TABLE_ID}/rows`,
      data: JSON.stringify(data, null, 2)
    })

    // Send to Coda
    const url = `${codaEP}/docs/${env.DOC_ID}/tables/${env.TASK_TABLE_ID}/rows`
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.CODA_API_KEY}`,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(
        `Coda API error: ${response.status} ${response.statusText}\nDetails: ${JSON.stringify(errorData, null, 2)}`
      )
    }

    const result = await response.json()
    log('info', 'Task added to Coda', {
      taskId: result.addedRowIds?.[0],
      status: 'success',
    })

    return result
  } catch (e) {
    log('error', 'Failed to add task to Coda', {
      error: e.message,
      stack: e.stack,
      requestData: data
    })
    throw e
  }
}

// Twilio webhook verification
const verifyTwilioWebhook = async (url, params, twilioSignature, authToken) => {
  // Sort the params alphabetically and join them
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], '')

  // Join the full URL and the sorted params
  const baseString = url + data

  // Convert auth token to Uint8Array
  const encoder = new TextEncoder()
  const keyData = encoder.encode(authToken)
  const messageData = encoder.encode(baseString)

  // Create key for HMAC using globalThis.crypto
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  )

  // Sign the message
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    messageData
  )

  // Convert to base64
  const signatureBase64 = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  )

  return signatureBase64 === twilioSignature
}

// Rate limiting - suggest 100 requests per hour per number as a starting point
const checkRateLimit = async (phoneNumber, env) => {
  const HOURLY_LIMIT = 100
  const key = `rate_limit:${phoneNumber}`
  const now = Date.now()
  const oneHour = 3600 * 1000

  try {
    const requests = (await env.text_to_coda.get(key, 'json')) || {
      count: 0,
      timestamp: now,
    }

    // Reset if window has passed
    if (now - requests.timestamp > oneHour) {
      requests.count = 1
      requests.timestamp = now
    } else {
      requests.count++
    }

    if (requests.count > HOURLY_LIMIT) {
      return false
    }

    await env.text_to_coda.put(key, JSON.stringify(requests), { expirationTtl: 3600 })
    return true
  } catch (e) {
    console.error('Rate limit error:', e)
    // Allow request through if KV fails
    return true
  }
}

const SHORTCUTS = {
  '!urgent': { status: '⭐️ Today' },
  '!later': { status: '🥶 Backlog' },
  '!week': { status: '📅 This Week' },
  '!wait': { status: '⌛ Waiting' },
}

const parseNaturalDate = (text) => {
  // Custom parser to handle relative dates better
  const parser = new chrono.Chrono()

  // Parse the date from the text
  const parsedDate = parser.parseDate(text)

  if (parsedDate) {
    // If time wasn't specified, set to end of day (5pm)
    if (
      !text.toLowerCase().includes('at') &&
      !text.toLowerCase().includes(':')
    ) {
      parsedDate.setHours(17, 0, 0, 0)
    }
    return parsedDate
  }

  return null
}

// Process text for shortcuts and dates
const processTaskText = (text) => {
  let taskData = {
    text: text,
    status: null,
    dueDate: null,
  }

  // Check for shortcuts
  for (const [shortcut, data] of Object.entries(SHORTCUTS)) {
    if (text.includes(shortcut)) {
      taskData.status = data.status
      taskData.text = text.replace(shortcut, '').trim()
    }
  }

  // Check for natural dates
  const date = parseNaturalDate(taskData.text)
  if (date) {
    // Format date as ISO-8601 string with timezone offset
    taskData.dueDate = date.toISOString().split('.')[0] + 'Z'
    log('info', 'Parsed date', { 
      originalDate: date,
      formattedDate: taskData.dueDate 
    })
    
    // Remove the parsed date text from the task description
    const dateText = taskData.text.match(/\b(today|tomorrow|next|this|in|on|at|by)\b.*$/i)?.[0] || ''
    if (dateText) {
      taskData.text = taskData.text.replace(dateText, '').trim()
    }
  }

  return taskData
}

const MetricsCollector = {
  metrics: {
    taskCount: 0,
    errorCount: 0,
    processingTimes: [],
    categoryDistribution: {},
    statusDistribution: {},
    hourlyDistribution: Array(24).fill(0),
  },

  recordTask(category, status, duration) {
    this.metrics.taskCount++
    this.metrics.categoryDistribution[category] =
      (this.metrics.categoryDistribution[category] || 0) + 1
    this.metrics.statusDistribution[status] =
      (this.metrics.statusDistribution[status] || 0) + 1
    this.metrics.hourlyDistribution[new Date().getHours()]++
  },

  recordError(error) {
    this.metrics.errorCount++
    console.error('Error:', error)
  },

  recordProcessingTime(startTime) {
    const duration = Date.now() - startTime
    this.metrics.processingTimes.push(duration)
  },

  getAverageProcessingTime() {
    return (
      this.metrics.processingTimes.reduce((a, b) => a + b, 0) /
      this.metrics.processingTimes.length
    )
  },

  getMetrics() {
    return {
      ...this.metrics,
      avgProcessingTime: this.getAverageProcessingTime(),
    }
  },
}

// Structured logging
const log = (level, message, data = {}) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    })
  )
}

export default {
  async fetch(request, env) {
    const startTime = Date.now()

    try {
      if (request.method !== 'POST') {
        throw new Error('Method not allowed')
      }

      const data = await request.text()
      const params = new URLSearchParams(data)
      const twilioObject = Object.fromEntries(params.entries())

      // Verify webhook
      const isValidWebhook = await verifyTwilioWebhook(
        request.url,
        twilioObject,
        request.headers.get('X-Twilio-Signature'),
        env.TWILIO_AUTH_TOKEN
      )

      if (!isValidWebhook) {
        throw new Error('Invalid webhook signature')
      }

      // Get the message text and phone number
      const message = twilioObject.Body
      const fromNumber = twilioObject.From

      if (!message || typeof message !== 'string') {
        throw new Error('Invalid message format')
      }

      // Re-enable rate limiting
      if (!(await checkRateLimit(fromNumber, env))) {
        return new Response('Too many requests. Please try again later.', { 
          status: 429 
        })
      }

      // Add task to Coda with the message
      const response = await addCodaTodo(message, env)

      // Record metrics
      MetricsCollector.recordTask(
        response.category,
        response.status,
        Date.now() - startTime
      )

      return new Response('Task added successfully!')
    } catch (error) {
      MetricsCollector.recordError(error)
      log('error', error.message, { stack: error.stack })
      return new Response('An error occurred', { status: 500 })
    } finally {
      MetricsCollector.recordProcessingTime(startTime)
    }
  },
}
