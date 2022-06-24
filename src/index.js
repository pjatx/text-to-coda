const codaEP = 'https://coda.io/apis/v1'

const addCodaTodo = async (text, env) => {
  const CODA_API_KEY = env.CODA_API_KEY
  const docId = env.DOC_ID
  const tableId = env.TABLE_ID

  let data = {
    'rows': [
      {
        'cells': [
          {
            // Task Name
            'column': 'c-70z9tdOF3c',
            'value': text
          },
          {
            'column': 'c-kN87N8b6Gr',
            'value': 'Backlog'
          },
          {
            'column': 'c-eDVIqu2xj_',
            'value': 'Inbox'
          }
        ]
      }
    ]
  }  

  const url = codaEP + '/docs/' + docId + '/tables/' + tableId + '/rows'
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
