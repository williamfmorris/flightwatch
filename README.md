# FlightWatch

Monitor Air Canada flights for delay risk based on inbound aircraft tracking. Get SMS alerts when a tight turnaround makes a delay likely.

## How it works

1. You give it a flight number (e.g. `AC123`) and a date
2. It looks up the flight via FlightAware AeroAPI
3. It finds the inbound aircraft and estimates its arrival time
4. It calculates whether there's enough turnaround time before your flight departs
5. It sends you an SMS if things look tight

## API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Server status |
| `GET /api/flight/AC123?date=YYYY-MM-DD` | Check a flight's delay risk |
| `POST /api/watch` | Start polling a flight every 5 min |
| `DELETE /api/watch/:watchId` | Stop watching a flight |
| `GET /api/watches` | List active watches |
| `GET /api/accuracy` | Historical accuracy by route |
| `GET /api/budget` | FlightAware API call count & cost |

### Watch a flight (POST /api/watch)

```json
{
  "flightNumber": "AC123",
  "date": "2026-03-04",
  "phone": "+14165550000"
}
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your keys:

```
FLIGHTAWARE_API_KEY=your_key_here
TWILIO_SID=your_twilio_sid
TWILIO_TOKEN=your_twilio_token
TWILIO_FROM=+1xxxxxxxxxx
PORT=3001
```

- **FlightAware AeroAPI key** — [aeroapi.flightaware.com](https://aeroapi.flightaware.com)
- **Twilio** — optional, needed for SMS alerts. [twilio.com](https://twilio.com)

### 3. Run

```bash
npm start
```

Server runs on port 3001. Test it:

```
http://localhost:3001/health
```

## Deploy

See [DEPLOY.md](DEPLOY.md) for instructions on deploying to Railway.

## Budget protection

The server enforces a hard cap of **2,000 FlightAware API calls** (~$20):
- Warning logged at 1,500 calls
- All polling halts automatically at 2,000
- Check usage at `/api/budget`
