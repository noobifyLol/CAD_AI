//This is for the 2OAuth so this application can access the project
import axios from 'axios';

let accessToken = null;

export function getAccessToken() {
  return accessToken;
}

export function getAuthUrl() {
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const redirectUri = encodeURIComponent("http://localhost:3000/oauthRedirect");
  return `https://oauth.onshape.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}`;
}

export async function exchangeCodeForToken(code) {
  const clientId = process.env.ONSHAPE_CLIENT_ID;
  const clientSecret = process.env.ONSHAPE_CLIENT_SECRET;

  const response = await axios.post('https://oauth.onshape.com/oauth/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: 'http://localhost:3000/oauthRedirect'
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );

  accessToken = response.data.access_token;
  return accessToken;
}