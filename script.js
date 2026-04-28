const ROOM_CODE_LENGTH = 6;
const LEFT_USER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' rx='60' fill='%23f3f4f6'/%3E%3Ccircle cx='60' cy='45' r='22' fill='%239ca3af'/%3E%3Cpath d='M24 102c6-20 23-30 36-30s30 10 36 30' fill='%239ca3af'/%3E%3C/svg%3E";

const videoGrid = document.getElementById('video-grid');
const roomCodeSpan = document.getElementById('room-code');
const chatBox = document.getElementById('chat-box');
const msgInput = document.getElementById('msg-input');
const notificationContainer = document.getElementById('notification-container');
const nameInput = document.getElementById('name-input');
const joinCodeInput = document.getElementById('join-code');
const joinBtn = document.getElementById('join-btn');
const sendBtn = document.getElementById('send-btn');
const muteBtn = document.getElementById('mute-btn');
const videoBtn = document.getElementById('video-btn');
const copyCodeBtn = document.getElementById('copy-code-btn');
const statusText = document.getElementById('status-text');
const participantCount = document.getElementById('participant-count');
const connectionState = document.getElementById('connection-state');

let myStream = null;
const peers = {};
const connections = [];
let localParticipantName = getInitialDisplayName();
let roomReady = false;
let mediaReady = false;
let joinInProgress = false;
const peer = createPeerWithShortCode();

initializeApp();

function initializeApp() {
    nameInput.value = localParticipantName;
    appendSystemMessage('Your room is being prepared. Share the code once it appears.');
    renderEmptyState();
    updateActionState();
    updateParticipantCount();

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            myStream = stream;
            mediaReady = true;
            addVideoStream('local-user', stream, true, localParticipantName);
            attachPeerCallHandler(stream);
            setStatus('Camera and microphone are ready.', 'Ready');
            updateActionState();
        })
        .catch(() => {
            setStatus('Camera or microphone permission was denied.', 'Permission needed');
            showNotification('Permission Required', 'Please allow camera and microphone access to use the call.');
            appendSystemMessage('Camera or microphone access is blocked. Please allow permissions and refresh.');
            muteBtn.disabled = true;
            videoBtn.disabled = true;
            updateActionState();
        });

    peer.on('open', id => {
        roomReady = true;
        roomCodeSpan.innerText = id;
        copyCodeBtn.disabled = false;
        setStatus(`Room ${id} is ready to share.`, 'Room ready');
        appendSystemMessage(`Your room code is ${id}. Share it with someone to start chatting.`);
        updateActionState();
    });

    peer.on('connection', conn => {
        if (conn.metadata?.name) {
            setParticipantName(conn.peer, conn.metadata.name);
        }
        appendSystemMessage(`${conn.metadata?.name || 'A participant'} joined the room.`);
        setupDataConnection(conn);
    });

    peer.on('error', err => {
        if (err.type !== 'unavailable-id') {
            setStatus('There was a connection issue with the room.', 'Connection issue');
            showNotification('Connection Problem', err.message || 'Something went wrong while connecting.');
        }
    });

    joinBtn.addEventListener('click', joinRoom);
    sendBtn.addEventListener('click', sendMessage);
    muteBtn.addEventListener('click', toggleMute);
    videoBtn.addEventListener('click', toggleVideo);
    copyCodeBtn.addEventListener('click', copyRoomCode);

    nameInput.addEventListener('input', event => {
        event.target.value = event.target.value.replace(/\s+/g, ' ').trimStart().slice(0, 20);
        updateActionState();
    });

    nameInput.addEventListener('change', () => {
        const participantName = getValidatedDisplayName();
        if (participantName) {
            updateLocalParticipantName(participantName);
        }
        updateActionState();
    });

    joinCodeInput.addEventListener('input', event => {
        event.target.value = event.target.value.replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
        updateActionState();
    });

    joinCodeInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            joinRoom();
        }
    });

    msgInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            sendMessage();
        }
    });

    window.addEventListener('beforeunload', () => {
        peer.destroy();
    });
}

function attachPeerCallHandler(stream) {
    peer.on('call', call => {
        call.answer(stream);
        registerPeerCall(call, call.metadata?.name || `Peer ${call.peer}`);
        call.on('stream', userVideoStream => {
            addVideoStream(call.peer, userVideoStream, false, peers[call.peer]?.label || call.metadata?.name || `Peer ${call.peer}`);
        });
    });
}

function joinRoom() {
    const participantName = getValidatedDisplayName();
    const roomId = joinCodeInput.value.trim();

    if (!participantName) {
        showNotification('Name Required', 'Please enter your name before joining a room.');
        nameInput.focus();
        return;
    }

    if (!mediaReady || !roomReady || joinInProgress) {
        return;
    }

    if (!isValidRoomCode(roomId)) {
        showNotification('Invalid Room Code', `Please enter a valid ${ROOM_CODE_LENGTH}-digit room code.`);
        joinCodeInput.focus();
        return;
    }

    if (roomId === peer.id) {
        showNotification('Same Room Code', 'You are already in this room as the host.');
        return;
    }

    joinInProgress = true;
    updateActionState();
    setStatus(`Joining room ${roomId}...`, 'Connecting');

    const call = peer.call(roomId, myStream, {
        metadata: { name: participantName }
    });

    registerPeerCall(call, `Peer ${roomId}`);
    call.on('stream', userVideoStream => {
        addVideoStream(roomId, userVideoStream, false, peers[roomId]?.label || `Peer ${roomId}`);
        joinInProgress = false;
        joinCodeInput.value = '';
        setStatus('Connected to the room.', 'Connected');
        appendSystemMessage('You joined the room successfully.');
        updateActionState();
    });

    call.on('error', () => {
        joinInProgress = false;
        setStatus('Could not complete the room connection.', 'Join failed');
        showNotification('Join Failed', 'Unable to connect to that room right now.');
        updateActionState();
    });

    const conn = peer.connect(roomId, {
        metadata: { name: participantName }
    });

    setupDataConnection(conn);
}

function sendMessage() {
    const text = msgInput.value.trim();
    if (text === '') {
        return;
    }

    appendMessage(localParticipantName, text);
    saveChatToLocal(`${localParticipantName}: ${text}`);

    connections.forEach(conn => conn.send({
        type: 'chat',
        senderName: localParticipantName,
        text
    }));

    msgInput.value = '';
}

function addVideoStream(peerId, stream, muted = false, label = 'Participant') {
    removeLeftParticipantCard(peerId);
    removeEmptyState();

    const existingCard = peers[peerId]?.card;
    const card = existingCard || createVideoCard(label);
    const mediaWrapper = card.querySelector('.video-media');
    const existingVideo = mediaWrapper.querySelector('video');
    const video = existingVideo || document.createElement('video');

    video.srcObject = stream;
    video.muted = muted;
    video.playsInline = true;

    if (!video.dataset.bound) {
        video.addEventListener('loadedmetadata', () => {
            video.play().catch(() => {});
        });
        video.dataset.bound = 'true';
    }

    if (!existingVideo) {
        mediaWrapper.appendChild(video);
    }

    if (!existingCard) {
        videoGrid.append(card);
    }

    updateParticipantLabel(card, label);

    peers[peerId] = {
        ...(peers[peerId] || {}),
        card,
        hasLeft: false,
        label
    };

    updateParticipantCount();
}

function setupDataConnection(conn) {
    const isNewConnection = !connections.some(existingConn => existingConn.connectionId === conn.connectionId);
    if (isNewConnection) {
        connections.push(conn);
    }

    conn.on('open', () => {
        peers[conn.peer] = {
            ...(peers[conn.peer] || {}),
            connection: conn,
            label: peers[conn.peer]?.label || conn.metadata?.name || `Peer ${conn.peer}`
        };

        conn.send({
            type: 'intro',
            name: localParticipantName
        });
    });

    conn.on('data', data => {
        if (data?.type === 'intro' && data.name) {
            setParticipantName(conn.peer, data.name);
            return;
        }

        if (data?.type === 'chat') {
            appendMessage(data.senderName || peers[conn.peer]?.label || 'Peer', data.text);
            saveChatToLocal(`${data.senderName || peers[conn.peer]?.label || 'Peer'}: ${data.text}`);
            return;
        }

        appendMessage(peers[conn.peer]?.label || 'Peer', data);
        saveChatToLocal(`${peers[conn.peer]?.label || 'Peer'}: ${data}`);
    });

    conn.on('close', () => {
        handleParticipantLeft(conn.peer);
        removeConnection(conn.connectionId);
        updateParticipantCount();
    });

    conn.on('error', () => {
        showNotification('Chat Connection Issue', 'A participant connection became unstable.');
    });
}

function appendMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg';
    msgDiv.innerText = `${sender}: ${text}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function appendSystemMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'system-msg';
    msgDiv.innerText = text;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function toggleMute() {
    if (!myStream) {
        return;
    }

    const audioTrack = myStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    muteBtn.innerText = audioTrack.enabled ? 'Mute Audio' : 'Unmute Audio';
    showNotification('Audio Updated', audioTrack.enabled ? 'Your microphone is on.' : 'Your microphone is muted.');
}

function toggleVideo() {
    if (!myStream) {
        return;
    }

    const videoTrack = myStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    videoBtn.innerText = videoTrack.enabled ? 'Turn Off Video' : 'Turn On Video';
    showNotification('Video Updated', videoTrack.enabled ? 'Your camera is on.' : 'Your camera is off.');
}

function copyRoomCode() {
    if (!peer.id) {
        return;
    }

    navigator.clipboard.writeText(peer.id)
        .then(() => {
            showNotification('Copied', 'Room code copied to clipboard.');
        })
        .catch(() => {
            showNotification('Copy Failed', 'Could not copy the room code automatically.');
        });
}

const STORAGE_LIMIT = 50000;

function saveChatToLocal(msg) {
    let chats = JSON.parse(localStorage.getItem('room_chats') || '[]');
    chats.push(msg);
    let chatString = JSON.stringify(chats);

    if (chatString.length > STORAGE_LIMIT) {
        downloadChatHistory(chatString);
        localStorage.removeItem('room_chats');
    } else {
        localStorage.setItem('room_chats', chatString);
    }
}

function downloadChatHistory(data) {
    const chatArray = JSON.parse(data);
    const textData = chatArray.join('\n');
    const blob = new Blob([textData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `Chat_Backup_${new Date().getTime()}.txt`;
    a.click();

    URL.revokeObjectURL(url);
    showNotification('Chat Backup Saved', 'Local chat history was downloaded because storage was full.');
}

function createPeerWithShortCode() {
    const roomCode = generateRoomCode();
    const shortCodePeer = new Peer(roomCode);

    shortCodePeer.on('error', err => {
        if (err.type === 'unavailable-id') {
            roomCodeSpan.innerText = 'Retrying...';
            setTimeout(() => window.location.reload(), 300);
        }
    });

    return shortCodePeer;
}

function generateRoomCode() {
    const min = 10 ** (ROOM_CODE_LENGTH - 1);
    const max = 10 ** ROOM_CODE_LENGTH;
    return Math.floor(min + Math.random() * (max - min)).toString();
}

function isValidRoomCode(roomCode) {
    return new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`).test(roomCode);
}

function createVideoCard(label) {
    const card = document.createElement('div');
    card.className = 'video-card';

    const mediaWrapper = document.createElement('div');
    mediaWrapper.className = 'video-media';

    const participantLabel = document.createElement('div');
    participantLabel.className = 'participant-label';
    participantLabel.innerText = label;

    card.append(mediaWrapper, participantLabel);
    return card;
}

function updateParticipantLabel(card, label) {
    const participantLabel = card.querySelector('.participant-label');
    if (participantLabel) {
        participantLabel.innerText = label;
    }
}

function registerPeerCall(call, label) {
    peers[call.peer] = {
        ...(peers[call.peer] || {}),
        call,
        label
    };

    call.on('close', () => {
        handleParticipantLeft(call.peer);
    });
}

function handleParticipantLeft(peerId) {
    const participant = peers[peerId];
    if (!participant || participant.hasLeft) {
        return;
    }

    participant.hasLeft = true;

    if (participant.card) {
        participant.card.remove();
    }

    showLeavePlaceholder(peerId, participant.label || `Peer ${peerId}`);
    showNotification('Participant Left', `${participant.label || `Peer ${peerId}`} is out of the room.`);
    appendSystemMessage(`${participant.label || `Peer ${peerId}`} left the room.`);
    updateParticipantCount();
}

function showLeavePlaceholder(peerId, label) {
    const card = document.createElement('div');
    card.className = 'video-card left-room-card';
    card.dataset.peerId = peerId;

    const image = document.createElement('img');
    image.src = LEFT_USER_IMAGE;
    image.alt = `${label} left the room`;

    const title = document.createElement('strong');
    title.innerText = label;

    const text = document.createElement('p');
    text.innerText = 'Left the room';

    card.append(image, title, text);
    videoGrid.append(card);

    peers[peerId] = {
        ...(peers[peerId] || {}),
        card,
        hasLeft: true,
        label
    };

    removeEmptyState();
}

function removeLeftParticipantCard(peerId) {
    const leftCard = videoGrid.querySelector(`[data-peer-id="${peerId}"]`);
    if (leftCard) {
        leftCard.remove();
    }
}

function showNotification(title, message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.innerHTML = `
        <div class="notification-title">${title}</div>
        <div class="notification-text">${message}</div>
    `;

    notificationContainer.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3200);
}

function removeConnection(connectionId) {
    const index = connections.findIndex(conn => conn.connectionId === connectionId);
    if (index !== -1) {
        connections.splice(index, 1);
    }
}

function getInitialDisplayName() {
    const savedName = localStorage.getItem('participant_name') || '';
    const validSavedName = sanitizeName(savedName);

    if (validSavedName) {
        return validSavedName;
    }

    const enteredName = prompt('Enter your name before using the room:') || '';
    const validName = sanitizeName(enteredName);

    if (!validName) {
        return 'Guest';
    }

    localStorage.setItem('participant_name', validName);
    return validName;
}

function getValidatedDisplayName() {
    const validName = sanitizeName(nameInput.value);

    if (!validName) {
        return '';
    }

    nameInput.value = validName;
    localStorage.setItem('participant_name', validName);
    localParticipantName = validName;
    return validName;
}

function sanitizeName(name) {
    return name.replace(/\s+/g, ' ').trim().slice(0, 20);
}

function updateLocalParticipantName(name) {
    localParticipantName = name;
    const localParticipant = peers['local-user'];

    if (localParticipant?.card) {
        updateParticipantLabel(localParticipant.card, name);
    }
}

function setParticipantName(peerId, name) {
    const label = sanitizeName(name) || `Peer ${peerId}`;

    peers[peerId] = {
        ...(peers[peerId] || {}),
        label
    };

    if (peers[peerId]?.card) {
        updateParticipantLabel(peers[peerId].card, label);
    }
}

function setStatus(text, state) {
    statusText.innerText = text;
    connectionState.innerText = state;
}

function updateActionState() {
    const hasName = sanitizeName(nameInput.value).length > 0;
    const hasJoinCode = isValidRoomCode(joinCodeInput.value.trim());

    joinBtn.disabled = !hasName || !hasJoinCode || !mediaReady || !roomReady || joinInProgress;
    sendBtn.disabled = !mediaReady;
    muteBtn.disabled = !mediaReady;
    videoBtn.disabled = !mediaReady;
}

function updateParticipantCount() {
    const activeParticipants = Object.values(peers).filter(participant => !participant.hasLeft).length;
    const count = Math.max(activeParticipants, mediaReady ? 1 : 0);
    participantCount.innerText = `${count} participant${count === 1 ? '' : 's'}`;
}

function renderEmptyState() {
    if (videoGrid.querySelector('.empty-state')) {
        return;
    }

    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
        <div>
            <strong>Waiting for participants</strong>
            Share your room code and someone can join the call.
        </div>
    `;

    videoGrid.appendChild(emptyState);
}

function removeEmptyState() {
    const emptyState = videoGrid.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
}
