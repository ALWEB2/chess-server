

const http = require('http')
const express = require('express')

const app = express()
app.use(express.static('public'))

const server = http.createServer(app)


const Database = require('@replit/database')
const db = new Database()
// db.set('users', [])

const io = require('socket.io')(server, {
  cors: {
    origin: ['https://live-chess-2.ducks-shitposts.repl.co', 'https://9019cfff-79ab-4578-8598-4304ebfe839e.id.repl.co', 'https://live-chess-2.jjroley.repl.co',],
    credentials: true,
    methods: ["GET", "POST"]
  },
  rejectUnauthorized: false
})

// db.get('users').then(data => {
//   console.log(data.length)
//   console.log(data.sort((a, b) => b.views - a.views).slice(0, 20))
// })


function generateId(l = 10) {
  const s = "abcdefghijklmnopqrstuvwxyz0123456789"
  return new Array(l).fill('_').map(_ => {
    let e = s[Math.floor(Math.random() * s.length)]
    if(Math.random() < 0.5) {
      return e.toUpperCase()
    }
    return e
  }).join('')
}

class Timer {
	constructor() {
  	this.init()
  }
  init() {
  	this.turn = 0
    let timerLength = 1000 * 60 * 10
    this.time = [timerLength, timerLength]
    this.lastTick = null
    this.started = false
    this.timeout = null
  }
  swap(sendTime) {
  	let now = Date.now()
  	let ping = now - sendTime
    this.time[this.turn] += ping
    this.time[this.turn] -= now - (this.lastTick || now)
    this.lastTick = now
  	this.turn = (this.turn + 1) % 2
    if(this.timeout) {
      clearTimeout(this.timeout)
    }
    this.timeout = setTimeout(() => {
      this.started = false
      if(this.onTimerEnd) {
        this.onTimerEnd(this)
      }
    }, this.time[this.turn])
  }
  currentTime(player) {
  	let now = Date.now()
  	return this.turn === player ? this.time[this.turn] - (now - (this.lastTick || now)) : this.time[player]
  }
  start() {
  	this.lastTick = Date.now()
    this.started = true
  }
  stop() {
    this.lastTick = null
    this.started = false
    clearTimeout(this.timeout)
    this.timeout = null
  }
  reset() {
  	this.init()
  }
}

class Game {
  constructor(isPublic = false) {
    this.id = generateId()
    this.moves = []
    this.players = []
    this.gameLength = 1000 * 60 * 10
    this.time = [this.gameLength, this.gameLength]
    this.timer = new Timer()
    this.timer.onTimerEnd = (timer) => {
      this.setGameOver({
        winner: this.turn === 0 ? 1 : 0,
        result: this.turn === 0 ? '0-1' : '1-0',
        reason: 'timeout'
      })
    }
    this.isPublic = isPublic
    this.gameOver = null
    this.turn = 0
    this.timeout = null;
    this._onGameOver = function() {}
    this.started = false
    this.active = [true, true]
    this.interval = null
    this.lastTick = null
  }
  join(id, username) {
    if(!username) username = "Guest"
    console.log('User: ' + username)
    let playerIndex = this.players.findIndex(p => p.id === id)
    if(playerIndex === -1) {
      if(this.players.length >= 2) return false
      if(this.players.length === 0) {
        this.active[0] = true
      }else {
        this.active[1] = true
      }
      this.players.push({ id, username })
    }
    return true
  }
  handleTime() {
    if(this.interval) {
      clearInterval(this.interval)
    }
    this.interval = setInterval(() => {
      let amt = this.lastTick == null ? 0 : Date.now() - this.lastTick
      this.lastTick = Date.now()
      this.time[this.turn] -= amt
      if(this.time[this.turn] <= 0) {
        this.setGameOver({
          winner: this.turn === 0 ? 1 : 0,
          result: this.turn === 0 ? '0-1' : '1-0',
          reason: 'timeout'
        })
        clearInterval(this.interval)
      } 
    }, 100)
  }
  data() {
    return {
      id: this.id,
      moves: this.moves,
      players: this.players,
      time: this.timer.time,
      turn: this.turn,
      gameOver: this.gameOver,
      isPublic: this.isPublic
    }
  }
  start() {
    if(this.started) return
    this.lastMoveTime = Date.now()
    this.started = true
    this.timer.start()
  }
  setGameOver(data) {
    if(this.timeout) {
      clearTimeout(this.timeout)
    }
    if(this.interval) {
    	clearInterval(this.interval)
    }
    let amt = this.lastTick || Date.now()
    this.time[this.turn] -= Date.now() - amt
    this.timer.stop()
    this.gameOver = data
    this._onGameOver(this.gameOver)
  }
  set onGameOver(cb) {
    this._onGameOver = cb
  }
  move(move, sendTime) {
    this.moves.push(move)
    let ping = Date.now() - sendTime
    this.time[this.turn] += ping
    let amt = this.lastTick || Date.now()
    /* this.time[this.turn] -= Date.now() - amt */
    this.timer.swap(sendTime)
    this.turn = this.turn === 0 ? 1 : 0
    this.lastMoveTime = Date.now()
  }
  runRematch() {
    this.players = this.players.reverse()
    this.time = [this.gameLength, this.gameLength]
    this.timer.reset()
    this.gameOver = null
    this.started = false 
    this.lastMoveTime = null
    this.turn = 0
    this.moves = []
  }
}

let games = []

let waitlistGameId;

let users = []
let dev_users = {}

io.on('connection', socket => {
  const playerId = socket.handshake.query.id
  let currentGameId;
  let username;
  
  socket.on('username', _username => {
    console.log('socket username')
    if(!_username) return
    username = _username
    dev_users[playerId] = { username: _username, inGame: false }
  })
  
  console.log("Client connected: " + playerId)
  function createGame(options) {
    let id = options && options.id || generateId()
    let game = new Game(options && options.isPublic)
    games.push(game)
    socket.emit('game id', game.id)
    return game.id
  }

  function joinGame(gameId, username) {
    if(!username) username = "Guest"
    let gameIndex = games.findIndex(g => g.id === gameId)
    if(gameIndex === -1) return socket.emit('leave')
    let game = games[gameIndex]
    socket.join(game.id)
    let joined = game.join(playerId, username)
    if(!joined) return socket.emit('leave')
    currentGameId = game.id
    game.onGameOver = function(data) {
      console.log('the game is over')
      io.in(currentGameId).emit('gameover', data)
    }
    socket.emit('game', game.data())
    if(game.players.length === 2) {
      game.start()
      io.in(currentGameId).emit('players', game.players)
    }
  }

  function leave() {
    let gameIndex = games.findIndex(g => g.id === currentGameId)
    if(gameIndex === -1) return
    let game = games[gameIndex]
    let pIndex = game.players.findIndex(p => p.id === playerId)
    game.active[pIndex] = false
    games = games.filter(g => g.active.find(a => !!a))
    if(currentGameId === waitlistGameId) {
      waitlistGameId = null // make sure someone joining the waitlist doesn't get paired with someone who has already left
    }
    socket.leaveAll()
    socket.broadcast.to(currentGameId).emit('player left')
    currentGameId = null
  }

  socket.on('create', data => {
    console.log('socket create')
    createGame(data)
  })

  socket.on('join game', (id, username) => {
    console.log('socket join')
    joinGame(id, username)
    
  })

  socket.on('waitlist', _username => {
    console.log('socket wait')
    if(waitlistGameId) {
      socket.emit('game id', waitlistGameId)
      console.log('User ' + _username + ' joined game as black')
      waitlistGameId = null
    }else {
      console.log('User ' + _username + ' joined game as white')
      waitlistGameId = createGame({ isPublic: true })
    }
  })

  socket.on('gameover', data => {
    console.log('socket gameover')
    let gameIndex = games.findIndex(g => g.id === currentGameId)
    if(gameIndex === -1) return
    let game = games[gameIndex]
    game.setGameOver(data)
  })

  socket.on('move', (move, sentAt) => {
    console.log('socket move')
    let gameIndex = games.findIndex(g => g.id === currentGameId)
    if(gameIndex === -1) return
    let game = games[gameIndex]
    // if(game.gameOver) return
    game.move(move, sentAt)
    socket.broadcast.to(currentGameId).emit('move', move, Date.now())
    io.in(currentGameId).emit('time-left', game.timer.time, Date.now())
  })

  socket.on('message', (data) => {
    console.log('socket message')
    socket.broadcast.to(currentGameId).emit('message', data)
  })

  socket.on('rematch', gameId => {
    console.log('socket rematch')
    let gameIndex = games.findIndex(g => g.id === currentGameId)
    if(gameIndex === -1) return
    let game = games[gameIndex]
    if(game.rematch) {
      game.rematch = null
      game.runRematch()
      game.start()
      io.in(gameId).emit('game', game.data())
    }else {
      game.rematch = playerId
    }
  })

  socket.on('leave', () => {
    console.log('socket leave')
    leave()
  })


  socket.on('disconnect', () => {
    console.log('socket disconnect')
    console.log("Client disconnected: " + playerId, username)
    leave()
    delete dev_users[playerId]
    // users = users.filter(u => u.id !== playerId)
  })

})
setInterval(() => {
  io.emit('get-users', Object.values(dev_users))
  io.emit('get-games', games.filter(g => g.players.length === 2).length)
}, 200)
server.listen(3000)