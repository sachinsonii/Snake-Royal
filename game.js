// Constants
const WORLD_SIZE = 3000; // World size
const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;
const SNAKE_INITIAL_LENGTH = 15;
const SHRINK_INTERVAL = 3000; // Snake shrinks every 3 seconds
const MAX_FOOD_COUNT = 500;
const MAX_PLAYER_SPEED = 5;
const BOOST_SPEED_MULTIPLIER = 1.8;
const SNAKE_ROTATION_SPEED = 0.08; // How fast the snake can turn
const SEGMENT_DISTANCE = 5; // Distance between snake segments
const FOOD_SIZE_RANGE = { min: 2, max: 8 }; // Range of food sizes

// DOM Elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');
const startMenu = document.getElementById('startMenu');
const gameContainer = document.getElementById('gameContainer');
const playerNameInput = document.getElementById('playerNameInput');
const playButton = document.getElementById('playButton');
const spectateButton = document.getElementById('spectateButton');
const statusMessage = document.getElementById('statusMessage');
const leaderboardContent = document.getElementById('leaderboardContent');
const lengthStat = document.getElementById('lengthStat');
const killsStat = document.getElementById('killsStat');
const boosterActive = document.getElementById('boosterActive');

// Game state
let peer;
let connections = {};
let players = {};
let foods = [];
let isPlaying = false;
let isSpectating = false;
let localPlayer = null;
let gameLoop;
let mousePosX = 0;
let mousePosY = 0;
let boosting = false;
let camera = { x: 0, y: 0 };
let lastUpdate = Date.now();
let gameState = 'waiting'; // waiting, playing, ended
let winnerId = null;
let peerId;
let foodColors = [
    { color: '#FF5722', chance: 0.65, score: 1 }, // Common orange orbs
    { color: '#E91E63', chance: 0.2, score: 2 },  // Uncommon pink orbs
    { color: '#9C27B0', chance: 0.1, score: 3 },  // Rare purple orbs
    { color: '#FFEB3B', chance: 0.05, score: 5 }  // Very rare yellow orbs
];

// Special abilities food types
const FOOD_TYPES = {
    NORMAL: { chance: 0.85 },
    BOOST: { 
        color: '#00BCD4', 
        chance: 0.08, 
        effect: 'boost', 
        duration: 3000 
    },
    SHIELD: { 
        color: '#2196F3', 
        chance: 0.04, 
        effect: 'shield', 
        duration: 5000 
    },
    GHOST: { 
        color: '#607D8B', 
        chance: 0.03, 
        effect: 'ghost', 
        duration: 4000 
    }
};

// Colors for players
const playerSkins = [
    { body: '#FF5733', pattern: '#FF8C66', eye: '#FFFFFF' },
    { body: '#33FF57', pattern: '#66FF88', eye: '#FFFFFF' },
    { body: '#3357FF', pattern: '#6680FF', eye: '#FFFFFF' },
    { body: '#F3FF33', pattern: '#F9FF99', eye: '#333333' },
    { body: '#FF33F3', pattern: '#FF88F8', eye: '#FFFFFF' },
    { body: '#33FFF3', pattern: '#66FFF8', eye: '#333333' },
    { body: '#FF8033', pattern: '#FFA066', eye: '#FFFFFF' },
    { body: '#8033FF', pattern: '#A066FF', eye: '#FFFFFF' },
    { body: '#33FF80', pattern: '#66FFA0', eye: '#333333' },
    { body: '#FF3380', pattern: '#FF66A0', eye: '#FFFFFF' }
];

// Initialize the game
function init() {
    // Setup event listeners
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', () => setBoosting(true));
    canvas.addEventListener('mouseup', () => setBoosting(false));
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    playButton.addEventListener('click', startPlaying);
    spectateButton.addEventListener('click', startSpectating);
    
    // Initialize PeerJS connection
    initPeerConnection();
}

// Initialize PeerJS connection
function initPeerConnection() {
    // Generate a random ID for this peer
    peerId = 'slither-' + Math.random().toString(36).substr(2, 9);
    
    peer = new Peer(peerId, {
        config: {
            'iceServers': [
                { url: 'stun:stun.l.google.com:19302' },
                { url: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });
    
    peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
        statusMessage.textContent = 'Connected to network. Waiting for other players...';
        
        // Look for existing players
        findExistingPlayers();
    });
    
    peer.on('connection', (conn) => {
        handleConnection(conn);
    });
    
    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        statusMessage.textContent = 'Connection error: ' + err.message;
    });
}

// Look for existing players
function findExistingPlayers() {
    // We use PeerJS' matchmaking to find other players
    // For simplicity, we'll try to connect to some predefined peer IDs
    // In a real app, you would use a signaling server
    
    // For demo purposes, we'll connect to some known peers
    peer.listAllPeers((peerIds) => {
        peerIds.forEach(id => {
            if (id !== peerId && id.startsWith('slither-')) {
                connectToPeer(id);
            }
        });
    });
}

// Connect to a specific peer
function connectToPeer(peerId) {
    const conn = peer.connect(peerId);
    handleConnection(conn);
}

// Handle a new connection
function handleConnection(conn) {
    conn.on('open', () => {
        console.log('Connected to: ' + conn.peer);
        
        // Store the connection
        connections[conn.peer] = conn;
        
        // If we're playing or spectating, send our current state
        if (isPlaying || isSpectating) {
            sendGameState(conn);
        }
        
        // Listen for data from this peer
        conn.on('data', (data) => {
            handlePeerData(conn.peer, data);
        });
        
        // Handle connection close
        conn.on('close', () => {
            console.log('Connection closed: ' + conn.peer);
            delete connections[conn.peer];
            if (players[conn.peer]) {
                delete players[conn.peer];
                updateLeaderboard();
                
                // Check if game should end
                checkGameEnd();
            }
        });
        
        // Request game state if we're new
        if (!isPlaying && !isSpectating) {
            conn.send({
                type: 'requestState'
            });
        }
    });
    
    conn.on('error', (err) => {
        console.error('Connection error:', err);
    });
}

// Handle data received from peers
function handlePeerData(peerId, data) {
    switch (data.type) {
        case 'playerJoin':
            // A new player has joined
            players[peerId] = {
                id: peerId,
                name: data.name,
                skin: data.skin,
                angle: data.angle,
                segments: data.segments,
                targetAngle: data.angle,
                speed: data.speed,
                score: data.score,
                kills: data.kills,
                alive: true,
                effects: {},
                lastUpdate: Date.now()
            };
            updateLeaderboard();
            break;
            
        case 'playerUpdate':
            // Update an existing player's state
            if (players[peerId]) {
                const player = players[peerId];
                player.angle = data.angle;
                player.targetAngle = data.angle;
                player.segments = data.segments;
                player.speed = data.speed;
                player.score = data.score;
                player.kills = data.kills;
                player.effects = data.effects;
                player.lastUpdate = Date.now();
            }
            break;
            
        case 'playerDied':
            // A player has died
            if (players[peerId]) {
                const killedBy = data.killedBy;
                players[peerId].alive = false;
                
                // If the player was killed by another player, update their kill count
                if (killedBy && players[killedBy]) {
                    players[killedBy].kills++;
                    
                    // If we are the killer, update UI
                    if (killedBy === localPlayer?.id) {
                        killsStat.textContent = `Kills: ${localPlayer.kills}`;
                        showStatusMessage(`You eliminated ${players[peerId].name}!`, 2000);
                    }
                }
                
                // Update leaderboard
                updateLeaderboard();
                
                // Check if game should end
                checkGameEnd();
            }
            break;
            
        case 'foodUpdate':
            // Update food positions
            foods = data.foods;
            break;
            
        case 'foodEaten':
            // Remove a food orb that was eaten
            const foodIndex = data.index;
            if (foodIndex >= 0 && foodIndex < foods.length) {
                // Apply special effect if applicable
                if (foods[foodIndex].type && foods[foodIndex].type.effect) {
                    if (peerId === localPlayer?.id) {
                        applyFoodEffect(foods[foodIndex].type);
                    }
                }
                
                // Remove the food
                foods.splice(foodIndex, 1);
                
                // Generate a new food if we're the host
                if (isOldestPeer()) {
                    generateFood(1);
                }
            }
            break;
            
        case 'gameState':
            // Receive full game state
            gameState = data.gameState;
            players = data.players;
            foods = data.foods;
            updateLeaderboard();
            break;
            
        case 'requestState':
            // Someone is requesting the current game state
            sendGameState(connections[peerId]);
            break;
            
        case 'gameEnd':
            // Game has ended
            gameState = 'ended';
            winnerId = data.winnerId;
            showGameEnd();
            break;
    }
}

// Send the current game state to a peer
function sendGameState(conn) {
    conn.send({
        type: 'gameState',
        gameState: gameState,
        players: players,
        foods: foods
    });
}

// Broadcast data to all connected peers
function broadcastData(data) {
    Object.values(connections).forEach(conn => {
        conn.send(data);
    });
}

// Handle mouse movement
function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mousePosX = e.clientX - rect.left;
    mousePosY = e.clientY - rect.top;
}

// Handle key down
function handleKeyDown(e) {
    if (e.code === 'Space') {
        setBoosting(true);
    }
}

// Handle key up
function handleKeyUp(e) {
    if (e.code === 'Space') {
        setBoosting(false);
    }
}

// Set boosting state
function setBoosting(state) {
    if (!isPlaying || !localPlayer || !localPlayer.alive) return;
    
    boosting = state;
    
    // Show/hide boost indicator
    boosterActive.classList.toggle('hidden', !boosting);
}

// Start playing the game
function startPlaying() {
    const playerName = playerNameInput.value.trim() || 'Player ' + Math.floor(Math.random() * 1000);
    
    // Hide the menu and show the game
    startMenu.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    
    // Set up local player
    const skinIndex = Math.floor(Math.random() * playerSkins.length);
    const playerSkin = playerSkins[skinIndex];
    
    // Random starting position
    const startX = Math.random() * WORLD_SIZE;
    const startY = Math.random() * WORLD_SIZE;
    
    // Random starting angle
    const startAngle = Math.random() * Math.PI * 2;
    
    // Create initial segments
    const segments = [];
    for (let i = 0; i < SNAKE_INITIAL_LENGTH; i++) {
        segments.push({
            x: startX - Math.cos(startAngle) * i * SEGMENT_DISTANCE,
            y: startY - Math.sin(startAngle) * i * SEGMENT_DISTANCE
        });
    }
    
    localPlayer = {
        id: peerId,
        name: playerName,
        skin: playerSkin,
        angle: startAngle,
        targetAngle: startAngle,
        segments: segments,
        speed: 3,
        score: SNAKE_INITIAL_LENGTH,
        kills: 0,
        alive: true,
        effects: {},
        lastUpdate: Date.now()
    };
    
    // Add local player to players list
    players[peerId] = localPlayer;
    
    // Update UI
    lengthStat.textContent = `Length: ${localPlayer.segments.length}`;
    killsStat.textContent = `Kills: ${localPlayer.kills}`;
    
    // Notify other players that we've joined
    broadcastData({
        type: 'playerJoin',
        name: playerName,
        skin: playerSkin,
        angle: startAngle,
        segments: segments,
        speed: 3,
        score: SNAKE_INITIAL_LENGTH,
        kills: 0
    });
    
    // If we're the first player, initialize the food
    if (isOldestPeer() && foods.length === 0) {
        initializeFood();
    }
    
    isPlaying = true;
    isSpectating = false;
    gameState = 'playing';
    
    // Start the game loop
    if (!gameLoop) {
        lastUpdate = Date.now();
        gameLoop = requestAnimationFrame(gameLoopFunction);
    }
    
    // Start the shrink timer
    startShrinkTimer();
    
    updateLeaderboard();
}

// Start spectating the game
function startSpectating() {
    // Hide the menu and show the game
    startMenu.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    
    isSpectating = true;
    
    // Start the game loop for rendering
    if (!gameLoop) {
        lastUpdate = Date.now();
        gameLoop = requestAnimationFrame(gameLoop);
    }
    
    statusMessage.textContent = 'Spectating the game...';
    
    updateLeaderboard();
}

// Initialize food on the game board
function initializeFood() {
    foods = [];
    generateFood(MAX_FOOD_COUNT);
}

// Generate food items
function generateFood(count) {
    for (let i = 0; i < count; i++) {
        if (foods.length >= MAX_FOOD_COUNT) return;
        
        // Choose a random food type
        const foodTypeRoll = Math.random();
        let foodType = null;
        let foodColor = getRandomFoodColor();
        
        // Determine if this will be a special food
        let cumulativeChance = 0;
        for (const [type, data] of Object.entries(FOOD_TYPES)) {
            cumulativeChance += data.chance;
            if (foodTypeRoll < cumulativeChance) {
                if (type !== 'NORMAL') {
                    foodType = data;
                    foodColor = data.color;
                }
                break;
            }
        }
        
        // Random position
        const x = Math.random() * WORLD_SIZE;
        const y = Math.random() * WORLD_SIZE;
        
        // Random size
        const size = Math.random() * (FOOD_SIZE_RANGE.max - FOOD_SIZE_RANGE.min) + FOOD_SIZE_RANGE.min;
        
        foods.push({
            x: x,
            y: y,
            color: foodColor,
            size: size,
            type: foodType,
            score: Math.ceil(size / 2)
        });
    }
    
    // Broadcast the new food list
    broadcastData({
        type: 'foodUpdate',
        foods: foods
    });
}

// Get a random food color based on rarity
function getRandomFoodColor() {
    const roll = Math.random();
    let cumulativeChance = 0;
    
    for (const food of foodColors) {
        cumulativeChance += food.chance;
        if (roll < cumulativeChance) {
            return food.color;
        }
    }
    
    return foodColors[0].color; // Default to first color
}

// Apply a food effect to the local player
function applyFoodEffect(foodType) {
    if (!localPlayer) return;
    
    switch (foodType.effect) {
        case 'boost':
            localPlayer.effects.boost = true;
            showStatusMessage('Speed Boost Activated!', foodType.duration);
            setTimeout(() => {
                localPlayer.effects.boost = false;
            }, foodType.duration);
            break;
            
        case 'shield':
            localPlayer.effects.shield = true;
            showStatusMessage('Shield Activated!', foodType.duration);
            setTimeout(() => {
                localPlayer.effects.shield = false;
            }, foodType.duration);
            break;
            
        case 'ghost':
            localPlayer.effects.ghost = true;
            showStatusMessage('Ghost Mode Activated!', foodType.duration);
            setTimeout(() => {
                localPlayer.effects.ghost = false;
            }, foodType.duration);
            break;
    }
}

// Show a status message temporarily
function showStatusMessage(message, duration) {
    statusMessage.textContent = message;
    statusMessage.style.opacity = 1;
    
    setTimeout(() => {
        statusMessage.style.opacity = 0;
    }, duration);
}

// Game loop function
function gameLoopFunction() {
    const now = Date.now();
    const deltaTime = (now - lastUpdate) / 1000; // Convert to seconds
    lastUpdate = now;
    
    update(deltaTime);
    render();
    
    requestAnimationFrame(gameLoopFunction);
}

// Update game state
function update(deltaTime) {
    if (!deltaTime) return;
    
    // If we're playing, update our own snake
    if (isPlaying && localPlayer && localPlayer.alive) {
        updateLocalPlayer(deltaTime);
        
        // Check for collisions with other snakes
        checkCollisions();
        
        // Check for food consumption
        checkFoodConsumption();
        
        // Update the camera to follow the player
        updateCamera();
        
        // Broadcast our updated state to other players
        broadcastData({
            type: 'playerUpdate',
            angle: localPlayer.angle,
            segments: localPlayer.segments,
            speed: localPlayer.speed,
            score: localPlayer.score,
            kills: localPlayer.kills,
            effects: localPlayer.effects
        });
        
        // Update UI
        lengthStat.textContent = `Length: ${localPlayer.segments.length}`;
    } else if (isSpectating) {
        // If spectating, follow the highest scoring player
        spectateHighestScorer();
    }
    
    // Interpolate movement for other players
    for (const id in players) {
        if (id === localPlayer?.id) continue; // Skip local player
        
        const player = players[id];
        if (!player.alive) continue;
        
        // Simple interpolation for remote players
        interpolatePlayerMovement(player, deltaTime);
    }
}

// Update the local player
function updateLocalPlayer(deltaTime) {
    // Calculate target angle based on mouse position
    const centerX = VIEWPORT_WIDTH / 2;
    const centerY = VIEWPORT_HEIGHT / 2;
    
    // Calculate angle to mouse position
    const dx = mousePosX - centerX;
    const dy = mousePosY - centerY;
    const targetAngle = Math.atan2(dy, dx);
    
    // Smoothly rotate towards target angle
    let angleDiff = targetAngle - localPlayer.angle;
    
    // Handle angle wrapping
    if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    
    // Apply rotation with speed limitation
    localPlayer.angle += angleDiff * SNAKE_ROTATION_SPEED * deltaTime * 60;
    
    // Normalize angle
    if (localPlayer.angle > Math.PI) localPlayer.angle -= Math.PI * 2;
    if (localPlayer.angle < -Math.PI) localPlayer.angle += Math.PI * 2;
    
    // Calculate speed based on boosting
    let currentSpeed = localPlayer.speed;
    
    // Apply boost if active
    if (boosting) {
        currentSpeed *= BOOST_SPEED_MULTIPLIER;
        
        // Shrink snake while boosting (every 5 frames)
        if (Math.random() < 0.2 && localPlayer.segments.length > 5) {
            localPlayer.segments.pop();
            localPlayer.score--;
        }
    }
    
    // Apply boost effect if active
    if (localPlayer.effects.boost) {
        currentSpeed *= 1.5;
    }
    
    // Calculate movement
    const velocityX = Math.cos(localPlayer.angle) * currentSpeed * deltaTime * 60;
    const velocityY = Math.sin(localPlayer.angle) * currentSpeed * deltaTime * 60;
    
    // Move head
    const newHead = {
        x: localPlayer.segments[0].x + velocityX,
        y: localPlayer.segments[0].y + velocityY
    };
    
    // Keep snake within world bounds
    newHead.x = Math.max(0, Math.min(WORLD_SIZE, newHead.x));
    newHead.y = Math.max(0, Math.min(WORLD_SIZE, newHead.y));
    
    // Add new head
    localPlayer.segments.unshift(newHead);
    
    // Remove tail
    localPlayer.segments.pop();
}

// Interpolate movement for remote players
function interpolatePlayerMovement(player, deltaTime) {
    // If the player hasn't been updated in a while, skip interpolation
    if (Date.now() - player.lastUpdate > 5000) return;
    
    // Smoothly interpolate angle
    let angleDiff = player.targetAngle - player.angle;
    
    // Handle angle wrapping
    if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    
    player.angle += angleDiff * SNAKE_ROTATION_SPEED * deltaTime * 60;
    
    // Normalize angle
    if (player.angle > Math.PI) player.angle -= Math.PI * 2;
    if (player.angle < -Math.PI) player.angle += Math.PI * 2;
    
    // Calculate movement
    const currentSpeed = player.speed * (player.effects.boost ? 1.5 : 1);
    const velocityX = Math.cos(player.angle) * currentSpeed * deltaTime * 60;
    const velocityY = Math.sin(player.angle) * currentSpeed * deltaTime * 60;
    
    // Move head
    const newHead = {
        x: player.segments[0].x + velocityX,
        y: player.segments[0].y + velocityY
    };
    
    // Keep snake within world bounds
    newHead.x = Math.max(0, Math.min(WORLD_SIZE, newHead.x));
    newHead.y = Math.max(0, Math.min(WORLD_SIZE, newHead.y));
    
    // Add new head
    player.segments.unshift(newHead);
    
    // Remove tail
    player.segments.pop();
}

// Check for collisions with other snakes
function checkCollisions() {
    if (!localPlayer || !localPlayer.alive) return;
    
    const head = localPlayer.segments[0];
    
    // Check collision with other players
    for (const id in players) {
        const player = players[id];
        if (!player.alive || player.id === localPlayer.id) continue;
        
        // Skip if we're in ghost mode
        if (localPlayer.effects.ghost) continue;
        
        // Skip if the other player is in ghost mode
        if (player.effects.ghost) continue;
        
        // Check collision with segments (skip head to allow head-to-head passing)
        for (let i = 1; i < player.segments.length; i++) {
            const segment = player.segments[i];
            const dx = head.x - segment.x;
            const dy = head.y - segment.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Snake width is proportional to its length, with a minimum
            const segmentRadius = Math.max(3, Math.min(8, 3 + player.segments.length / 50));
            const headRadius = Math.max(3, Math.min(8, 3 + localPlayer.segments.length / 50));
            
            if (distance < segmentRadius + headRadius) {
                // If we have a shield, don't die and remove the shield
                if (localPlayer.effects.shield) {
                    localPlayer.effects.shield = false;
                    showStatusMessage('Shield Protected You!', 2000);
                    return;
                }
                
                handlePlayerDeath(player.id);
                return;
            }
        }
    }
    
    // Check collision with own body (allow collision with the first few segments)
    for (let i = 5; i < localPlayer.segments.length; i++) {
        const segment = localPlayer.segments[i];
        const dx = head.x - segment.x;
        const dy = head.y - segment.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const segmentRadius = Math.max(3, Math.min(8, 3 + localPlayer.segments.length / 50));
        
        if (distance < segmentRadius * 1.5) {
            // If we have a shield, don't die and remove the shield
            if (localPlayer.effects.shield) {
                localPlayer.effects.shield = false;
                showStatusMessage('Shield Protected You!', 2000);
                return;
            }
            
            handlePlayerDeath(null); // Self-collision
            return;
        }
    }
    
    // Check collision with world boundaries (optional)
    if (head.x <= 0 || head.x >= WORLD_SIZE || head.y <= 0 || head.y >= WORLD_SIZE) {
        // If we have a shield, don't die and remove the shield
        if (localPlayer.effects.shield) {
            localPlayer.effects.shield = false;
            showStatusMessage('Shield Protected You!', 2000);
            return;
        }
        
        handlePlayerDeath(null); // Boundary collision
    }
}

// Check for food consumption
function checkFoodConsumption() {
    if (!localPlayer || !localPlayer.alive) return;
    
    const head = localPlayer.segments[0];
    const headRadius = Math.max(3, Math.min(8, 3 + localPlayer.segments.length / 50));
    
    for (let i = 0; i < foods.length; i++) {
        const food = foods[i];
        const dx = head.x - food.x;
        const dy = head.y - food.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < headRadius + food.size) {
            // Consume the food
            const scoreGain = food.score || 1;
            localPlayer.score += scoreGain;
            
            // Grow the snake
            for (let j = 0; j < scoreGain; j++) {
                const lastSegment = localPlayer.segments[localPlayer.segments.length - 1];
                localPlayer.segments.push({ x: lastSegment.x, y: lastSegment.y });
            }
            
            // Apply effect if it's a special food
            if (food.type && food.type.effect) {
                applyFoodEffect(food.type);
            }
            
            // Update UI
            lengthStat.textContent = `Length: ${localPlayer.segments.length}`;
            
            // Notify others that we ate this food
            broadcastData({
                type: 'foodEaten',
                index: i
            });
            
            // Remove the food locally
            foods.splice(i, 1);
            i--;
            
            // If we're the host, generate a new food
            if (isOldestPeer()) {
                generateFood(1);
            }
        }
    }
}

// Handle player death
function handlePlayerDeath(killedById) {
    if (!localPlayer) return;
    
    localPlayer.alive = false;
    isPlaying = false;
    
    // Notify others that we died
    broadcastData({
        type: 'playerDied',
        killedBy: killedById
    });
    
    // Update UI
    showStatusMessage('You died! Click to restart.', 5000);
    
    // Convert body to food
    if (isOldestPeer()) {
        for (let i = 0; i < localPlayer.segments.length; i += 3) {
            const segment = localPlayer.segments[i];
            
            if (foods.length < MAX_FOOD_COUNT) {
                foods.push({
                    x: segment.x,
                    y: segment.y,
                    color: localPlayer.skin.body,
                    size: FOOD_SIZE_RANGE.min,
                    score: 1
                });
            }
        }
        
        // Broadcast the new food list
        broadcastData({
            type: 'foodUpdate',
            foods: foods
        });
    }
    
    // Update leaderboard
    updateLeaderboard();
    
    // Check if game should end
    checkGameEnd();
    
    // Allow clicking to restart
    canvas.addEventListener('click', restartGame);
}

// Restart the game
function restartGame() {
    // Remove the click listener
    canvas.removeEventListener('click', restartGame);
    
    // Hide the game and show the menu
    gameContainer.classList.add('hidden');
    startMenu.classList.remove('hidden');
    
    // Reset game state
    isPlaying = false;
    isSpectating = false;
    localPlayer = null;
    
    // Reset UI
    statusMessage.textContent = '';
}

// Update the camera position to follow the local player
function updateCamera() {
    if (!localPlayer || !localPlayer.alive) return;
    
    const head = localPlayer.segments[0];
    
    // Center the camera on the player's head
    camera.x = head.x - VIEWPORT_WIDTH / 2;
    camera.y = head.y - VIEWPORT_HEIGHT / 2;
    
    // Keep camera within world bounds
    camera.x = Math.max(0, Math.min(WORLD_SIZE - VIEWPORT_WIDTH, camera.x));
    camera.y = Math.max(0, Math.min(WORLD_SIZE - VIEWPORT_HEIGHT, camera.y));
}

// Spectate the highest scoring player
function spectateHighestScorer() {
    let highestScore = -1;
    let highestScorer = null;
    
    for (const id in players) {
        const player = players[id];
        if (player.alive && player.score > highestScore) {
            highestScore = player.score;
            highestScorer = player;
        }
    }
    
    if (highestScorer) {
        const head = highestScorer.segments[0];
        
        // Center the camera on the player's head
        camera.x = head.x - VIEWPORT_WIDTH / 2;
        camera.y = head.y - VIEWPORT_HEIGHT / 2;
        
        // Keep camera within world bounds
        camera.x = Math.max(0, Math.min(WORLD_SIZE - VIEWPORT_WIDTH, camera.x));
        camera.y = Math.max(0, Math.min(WORLD_SIZE - VIEWPORT_HEIGHT, camera.y));
        
        statusMessage.textContent = `Spectating: ${highestScorer.name}`;
    } else {
        statusMessage.textContent = 'Spectating: No active players';
    }
}

// Render the game
function render() {
    // Clear the canvas
    ctx.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    
    // Draw background grid
    drawGrid();
    
    // Draw food
    drawFood();
    
    // Draw players
    drawPlayers();
    
    // Draw minimap
    drawMinimap();
    
    // Draw game-end message if needed
    if (gameState === 'ended') {
        drawGameEndMessage();
    }
}

// Draw the background grid
function drawGrid() {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    
    // Calculate grid offsets based on camera position
    const offsetX = -camera.x % 50;
    const offsetY = -camera.y % 50;
    
    // Draw vertical lines
    for (let x = offsetX; x < VIEWPORT_WIDTH; x += 50) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, VIEWPORT_HEIGHT);
    }
    
    // Draw horizontal lines
    for (let y = offsetY; y < VIEWPORT_HEIGHT; y += 50) {
        ctx.moveTo(0, y);
        ctx.lineTo(VIEWPORT_WIDTH, y);
    }
    
    ctx.stroke();
}

// Draw all food orbs
function drawFood() {
    for (const food of foods) {
        // Check if food is in view
        if (food.x < camera.x - 50 || food.x > camera.x + VIEWPORT_WIDTH + 50 ||
            food.y < camera.y - 50 || food.y > camera.y + VIEWPORT_HEIGHT + 50) {
            continue;
        }
        
        const screenX = food.x - camera.x;
        const screenY = food.y - camera.y;
        
        // Draw food orb
        ctx.beginPath();
        ctx.fillStyle = food.color;
        ctx.arc(screenX, screenY, food.size, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw glow effect for special foods
        if (food.type && food.type.effect) {
            ctx.beginPath();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.arc(screenX, screenY, food.size * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// Draw all players
function drawPlayers() {
    // Sort players by score to ensure proper layering
    const playerIds = Object.keys(players).sort((a, b) => players[a].score - players[b].score);
    
    for (const id of playerIds) {
        const player = players[id];
        if (!player.alive) continue;
        
        // Check if any part of the snake is in view
        let isVisible = false;
        for (const segment of player.segments) {
            if (segment.x > camera.x - 50 && segment.x < camera.x + VIEWPORT_WIDTH + 50 &&
                segment.y > camera.y - 50 && segment.y < camera.y + VIEWPORT_HEIGHT + 50) {
                isVisible = true;
                break;
            }
        }
        
        if (!isVisible) continue;
        
        // Draw the snake
        drawSnake(player);
        
        // Draw player name if in view
        const head = player.segments[0];
        const screenX = head.x - camera.x;
        const screenY = head.y - camera.y;
        
        if (screenX > 0 && screenX < VIEWPORT_WIDTH && screenY > 0 && screenY < VIEWPORT_HEIGHT) {
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.font = '12px Arial';
            ctx.fillText(player.name, screenX, screenY - 20);
            
            // Draw effects indicators
            if (Object.keys(player.effects).length > 0) {
                let effectY = screenY - 35;
                if (player.effects.boost) {
                    ctx.fillStyle = '#00BCD4';
                    ctx.fillText('⚡', screenX, effectY);
                    effectY -= 15;
                }
                if (player.effects.shield) {
                    ctx.fillStyle = '#2196F3';
                    ctx.fillText('🛡️', screenX, effectY);
                    effectY -= 15;
                }
                if (player.effects.ghost) {
                    ctx.fillStyle = '#607D8B';
                    ctx.fillText('👻', screenX, effectY);
                }
            }
        }
    }
}

// Draw a single snake
function drawSnake(player) {
    const segments = player.segments;
    if (segments.length === 0) return;
    
    // Calculate snake width based on length
    const maxWidth = Math.min(8, 3 + segments.length / 50);
    
    // Apply ghost effect if active
    const ghostAlpha = player.effects.ghost ? 0.5 : 1;
    
    // Draw body segments
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i];
        const screenX = segment.x - camera.x;
        const screenY = segment.y - camera.y;
        
        // Skip if not in view
        if (screenX < -maxWidth || screenX > VIEWPORT_WIDTH + maxWidth ||
            screenY < -maxWidth || screenY > VIEWPORT_HEIGHT + maxWidth) {
            continue;
        }
        
        // Calculate width for this segment
        const segmentRatio = 1 - (i / segments.length * 0.5);
        const width = maxWidth * segmentRatio;
        
        // Alternate pattern
        const isPattern = i % 5 < 2;
        
        // Draw segment
        ctx.beginPath();
        ctx.fillStyle = isPattern 
            ? withOpacity(player.skin.pattern, ghostAlpha) 
            : withOpacity(player.skin.body, ghostAlpha);
        ctx.arc(screenX, screenY, width, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw shield effect if active and this is the head or near the head
        if (player.effects.shield && i < 5) {
            ctx.beginPath();
            ctx.strokeStyle = withOpacity('#2196F3', 0.7 * ghostAlpha);
            ctx.lineWidth = 2;
            ctx.arc(screenX, screenY, width + 3, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    
    // Draw eyes (only for the head)
    const head = segments[0];
    const screenX = head.x - camera.x;
    const screenY = head.y - camera.y;
    
    if (screenX > -maxWidth && screenX < VIEWPORT_WIDTH + maxWidth &&
        screenY > -maxWidth && screenY < VIEWPORT_HEIGHT + maxWidth) {
        
        // Calculate eye positions based on the angle
        const eyeDistance = maxWidth * 0.5;
        const eyeSize = maxWidth * 0.3;
        
        // Left eye
        const leftEyeX = screenX + Math.cos(player.angle - Math.PI / 4) * eyeDistance;
        const leftEyeY = screenY + Math.sin(player.angle - Math.PI / 4) * eyeDistance;
        
        // Right eye
        const rightEyeX = screenX + Math.cos(player.angle + Math.PI / 4) * eyeDistance;
        const rightEyeY = screenY + Math.sin(player.angle + Math.PI / 4) * eyeDistance;
        
        // Draw eyes
        ctx.beginPath();
        ctx.fillStyle = withOpacity(player.skin.eye, ghostAlpha);
        ctx.arc(leftEyeX, leftEyeY, eyeSize, 0, Math.PI * 2);
        ctx.arc(rightEyeX, rightEyeY, eyeSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw pupils
        ctx.beginPath();
        ctx.fillStyle = withOpacity('#000000', ghostAlpha);
        ctx.arc(leftEyeX + Math.cos(player.angle) * (eyeSize * 0.3),
                leftEyeY + Math.sin(player.angle) * (eyeSize * 0.3), 
                eyeSize * 0.6, 0, Math.PI * 2);
        ctx.arc(rightEyeX + Math.cos(player.angle) * (eyeSize * 0.3),
                rightEyeY + Math.sin(player.angle) * (eyeSize * 0.3), 
                eyeSize * 0.6, 0, Math.PI * 2);
        ctx.fill();
    }
}

// Helper function to add opacity to a color
function withOpacity(color, alpha) {
    if (color.startsWith('rgba')) {
        return color.replace(/[\d\.]+\)$/, alpha + ')');
    } else if (color.startsWith('rgb')) {
        return color.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
    } else {
        // Assume hex
        return color + Math.round(alpha * 255).toString(16).padStart(2, '0');
    }
}

// Draw the minimap
function drawMinimap() {
    // Clear the minimap
    minimapCtx.clearRect(0, 0, minimap.width, minimap.height);
    
    // Draw the background
    minimapCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    minimapCtx.fillRect(0, 0, minimap.width, minimap.height);
    
    // Draw the viewport rectangle
    const vpX = (camera.x / WORLD_SIZE) * minimap.width;
    const vpY = (camera.y / WORLD_SIZE) * minimap.height;
    const vpW = (VIEWPORT_WIDTH / WORLD_SIZE) * minimap.width;
    const vpH = (VIEWPORT_HEIGHT / WORLD_SIZE) * minimap.height;
    
    minimapCtx.strokeStyle = 'white';
    minimapCtx.lineWidth = 1;
    minimapCtx.strokeRect(vpX, vpY, vpW, vpH);
    
    // Draw player locations
    for (const id in players) {
        const player = players[id];
        if (!player.alive || player.segments.length === 0) continue;
        
        const head = player.segments[0];
        const x = (head.x / WORLD_SIZE) * minimap.width;
        const y = (head.y / WORLD_SIZE) * minimap.height;
        
        // Draw player dot
        minimapCtx.fillStyle = player.id === localPlayer?.id ? '#FFFFFF' : player.skin.body;
        minimapCtx.beginPath();
        minimapCtx.arc(x, y, player.id === localPlayer?.id ? 3 : 2, 0, Math.PI * 2);
        minimapCtx.fill();
    }
}

// Draw the game end message
function drawGameEndMessage() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    
    ctx.fillStyle = '#4CAF50';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px Arial';
    ctx.fillText('Game Over!', VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 - 50);
    
    if (winnerId && players[winnerId]) {
        ctx.fillStyle = 'white';
        ctx.font = '30px Arial';
        ctx.fillText(`${players[winnerId].name} Won!`, VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
        
        ctx.font = '24px Arial';
        ctx.fillText(`Length: ${players[winnerId].segments.length} - Kills: ${players[winnerId].kills}`, 
                    VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 + 40);
    }
    
    ctx.font = '20px Arial';
    ctx.fillText('Click to play again', VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2 + 100);
}

// Update the leaderboard
function updateLeaderboard() {
    // Sort players by score
    const sortedPlayers = Object.values(players)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5); // Show top 5
    
    // Clear the leaderboard
    leaderboardContent.innerHTML = '';
    
    // Add each player to the leaderboard
    for (const player of sortedPlayers) {
        const playerItem = document.createElement('div');
        playerItem.className = 'player-item';
        
        const playerName = document.createElement('div');
        playerName.className = 'player-name';
        
        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'color-indicator';
        colorIndicator.style.backgroundColor = player.skin.body;
        
        const nameText = document.createElement('span');
        nameText.textContent = player.name;
        
        // Mark dead players
        if (!player.alive) {
            nameText.style.textDecoration = 'line-through';
            nameText.style.opacity = '0.5';
        }
        
        // Mark the local player
        if (player.id === localPlayer?.id) {
            nameText.style.fontWeight = 'bold';
        }
        
        playerName.appendChild(colorIndicator);
        playerName.appendChild(nameText);
        
        const playerScore = document.createElement('div');
        playerScore.textContent = player.score;
        
        playerItem.appendChild(playerName);
        playerItem.appendChild(playerScore);
        
        leaderboardContent.appendChild(playerItem);
    }
}

// Check if the game should end
function checkGameEnd() {
    // Game ends when only one player is alive or no players are alive
    const alivePlayers = Object.values(players).filter(p => p.alive);
    
    if (alivePlayers.length === 1) {
        gameState = 'ended';
        winnerId = alivePlayers[0].id;
        
        // Notify all players that the game has ended
        broadcastData({
            type: 'gameEnd',
            winnerId: winnerId
        });
        
        showGameEnd();
    } else if (alivePlayers.length === 0 && Object.keys(players).length > 0) {
        gameState = 'ended';
        
        // Notify all players that the game has ended
        broadcastData({
            type: 'gameEnd',
            winnerId: null
        });
        
        showGameEnd();
    }
}

// Show game end screen
function showGameEnd() {
    // Allow clicking to restart
    canvas.addEventListener('click', restartGame);
}

// Start the shrink timer
function startShrinkTimer() {
    // Shrink the snake over time
    setInterval(() => {
        if (isPlaying && localPlayer && localPlayer.alive && localPlayer.segments.length > 5) {
            // Remove the last segment
            localPlayer.segments.pop();
            localPlayer.score--;
            
            // Update UI
            lengthStat.textContent = `Length: ${localPlayer.segments.length}`;
        }
    }, SHRINK_INTERVAL);
}

// Check if this peer is the oldest connected peer
function isOldestPeer() {
    if (Object.keys(connections).length === 0) return true;
    
    // Get the oldest peer by ID (assuming IDs are created with timestamps)
    const oldestPeerId = Object.keys(connections)
        .reduce((oldest, current) => 
            current.localeCompare(oldest) < 0 ? current : oldest, peerId);
    
    return peerId.localeCompare(oldestPeerId) <= 0;
}

// Initialize the game
window.onload = init;