const ROOM_CODE_LENGTH = 6;
const MAX_CALL_RETRIES = 2;
const CALL_RETRY_DELAY = 1800;
const LEFT_USER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' rx='60' fill='%23f3f4f6'/%3E%3Ccircle cx='60' cy='45' r='22' fill='%239ca3af'/%3E%3Cpath d='M24 102c6-20 23-30 36-30s30 10 36 30' fill='%239ca3af'/%3E%3C/svg%3E";
const MEDIA_CONSTRAINTS = {
    video: {
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: 'user'
    },
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
};
const FALLBACK_MEDIA_CONSTRAINTS = { video: true, audio: true };
const PEER_OPTIONS = {
    debug: 1,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            {
                urls: [
                    'turn:eu-0.turn.peerjs.com:3478',
                    'turn:us-0.turn.peerjs.com:3478'
                ],
                username: 'peerjs',
                credential: 'peerjsp'
            }
        ],
        iceCandidatePoolSize: 10,
        sdpSemantics: 'unified-plan'
    }
};

const videoGrid = document.getElementById('video-grid');
const roomCodeSpan = document.getElementById('room-code');
const chatBox = document.getElementById('chat-box');
const msgInput = document.getElementById('msg-input');
const notificationContainer = document.getElementById('notification-container');
const homeScreen = document.getElementById('home-screen');
const appContent = document.getElementById('app-content');
const homeHostBtn = document.getElementById('home-host-btn');
const homeJoinBtn = document.getElementById('home-join-btn');
const homeForm = document.getElementById('home-form');
const homeNameInput = document.getElementById('home-name-input');
const homeRoomField = document.getElementById('home-room-field');
const homeRoomCodeInput = document.getElementById('home-room-code-input');
const homeStartHostBtn = document.getElementById('home-start-host-btn');
const homeStartJoinBtn = document.getElementById('home-start-join-btn');
const nameInput = document.getElementById('name-input');
const joinCodeInput = document.getElementById('join-code');
const joinBtn = document.getElementById('join-btn');
const hostPanel = document.getElementById('host-panel');
const joinPanel = document.getElementById('join-panel');
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
let roomHostId = null;
let meetingMode = null;
let pendingJoinRoomId = null;
let mediaRequest = null;
let callHandlerAttached = false;
const peer = createPeerWithShortCode();

initializeApp();

function initializeApp() {
    nameInput.value = localParticipantName;
    appendSystemMessage('Your room is being prepared. Share the code once it appears.');
    renderEmptyState();
    updateActionState();
    updateParticipantCount();
    attachPeerCallHandler();

    peer.on('open', id => {
        roomReady = true;
        roomHostId = id;
        roomCodeSpan.innerText = id;
        copyCodeBtn.disabled = false;
        setStatus(`Room ${id} is ready to share.`, 'Room ready');
        appendSystemMessage(`Your room code is ${id}. Share it with someone to start chatting.`);
        updateActionState();
        attemptPendingJoin();
    });

    peer.on('connection', conn => {
        if (conn.metadata?.name) {
            setParticipantName(conn.peer, conn.metadata.name);
        }
        appendSystemMessage(`${conn.metadata?.name || 'A participant'} joined the room.`);
        setupDataConnection(conn);
    });

    peer.on('error', err => {
        if (err.type === 'peer-unavailable') {
            joinInProgress = false;
            pendingJoinRoomId = null;
            setStatus('That room is not available right now.', 'Room not found');
            showNotification('Room Not Found', 'Please check the 6-digit room code and try again.');
            updateActionState();
            return;
        }

        if (err.type !== 'unavailable-id') {
            setStatus('There was a connection issue with the room.', 'Connection issue');
            showNotification('Connection Problem', err.message || 'Something went wrong while connecting.');
        }
    });

    joinBtn.addEventListener('click', joinRoom);
    homeHostBtn.addEventListener('click', () => setHomeMode('host'));
    homeJoinBtn.addEventListener('click', () => setHomeMode('join'));
    homeStartHostBtn.addEventListener('click', startHostFromHome);
    homeStartJoinBtn.addEventListener('click', startJoinFromHome);
    sendBtn.addEventListener('click', sendMessage);
    muteBtn.addEventListener('click', toggleMute);
    videoBtn.addEventListener('click', toggleVideo);
    copyCodeBtn.addEventListener('click', copyRoomCode);

    nameInput.addEventListener('input', event => {
        event.target.value = event.target.value.replace(/\s+/g, ' ').trimStart().slice(0, 20);
        updateActionState();
    });

    homeNameInput.addEventListener('input', event => {
        event.target.value = event.target.value.replace(/\s+/g, ' ').trimStart().slice(0, 20);
    });

    homeRoomCodeInput.addEventListener('input', event => {
        event.target.value = event.target.value.replace(/\D/g, '').slice(0, ROOM_CODE_LENGTH);
    });

    homeNameInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            meetingMode === 'join' ? startJoinFromHome() : startHostFromHome();
        }
    });

    homeRoomCodeInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            startJoinFromHome();
        }
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

    setStatus('Choose host or join to continue.', 'Welcome');
}

function attachPeerCallHandler() {
    if (callHandlerAttached) {
        return;
    }

    callHandlerAttached = true;

    peer.on('call', call => {
        const callerName = call.metadata?.name || `Peer ${call.peer}`;
        setParticipantName(call.peer, callerName);

        ensureLocalMedia().then(stream => {
            call.answer(stream);
            registerPeerCall(call, callerName);
            attachRemoteStreamHandler(call, callerName);
        }).catch(() => {
            call.close();
            showNotification('Call Blocked', 'Camera or microphone permission is needed before answering.');
        });
    });
}

function ensureLocalMedia() {
    if (mediaReady && myStream) {
        return Promise.resolve(myStream);
    }

    if (mediaRequest) {
        return mediaRequest;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('This browser does not support camera access.', 'Unsupported');
        showNotification('Unsupported Browser', 'Please use a modern Chrome, Edge, Safari, or Firefox browser.');
        return Promise.reject(new Error('getUserMedia is not supported'));
    }

    setStatus('Asking for camera and microphone permission...', 'Permission needed');

    mediaRequest = getLocalMediaStream()
        .then(stream => {
            myStream = stream;
            mediaReady = true;
            addVideoStream('local-user', stream, true, localParticipantName || 'You');
            setStatus('Camera and microphone are ready.', 'Ready');
            updateActionState();
            attemptPendingJoin();
            return stream;
        })
        .catch(error => {
            mediaRequest = null;
            setStatus('Camera or microphone permission was denied.', 'Permission needed');
            showNotification('Permission Required', 'Please allow camera and microphone access to use the call.');
            appendSystemMessage('Camera or microphone access is blocked. Please allow permissions and refresh.');
            muteBtn.disabled = true;
            videoBtn.disabled = true;
            updateActionState();
            throw error;
        });

    return mediaRequest;
}

function getLocalMediaStream() {
    return navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS)
        .catch(() => navigator.mediaDevices.getUserMedia(FALLBACK_MEDIA_CONSTRAINTS));
}

function joinRoom() {
    if (meetingMode !== 'join') {
        showNotification('Join Mode Required', 'Choose "Join a Meeting" first.');
        return;
    }

    const participantName = getValidatedDisplayName();
    const roomId = joinCodeInput.value.trim();

    if (!participantName) {
        showNotification('Name Required', 'Please enter your name before joining a room.');
        nameInput.focus();
        return;
    }

    if (!isValidRoomCode(roomId)) {
        showNotification('Invalid Room Code', `Please enter a valid ${ROOM_CODE_LENGTH}-digit room code.`);
        joinCodeInput.focus();
        return;
    }

    if (!mediaReady || !roomReady || joinInProgress) {
        pendingJoinRoomId = roomId;
        setStatus('Getting your camera and room ready...', 'Preparing');
        return;
    }

    if (roomId === peer.id) {
        showNotification('Same Room Code', 'You are already in this room as the host.');
        return;
    }

    joinInProgress = true;
    pendingJoinRoomId = null;
    roomHostId = roomId;
    updateActionState();
    setStatus(`Joining room ${roomId}...`, 'Connecting');

    const call = startPeerCall(roomId, `Peer ${roomId}`);
    if (!call) {
        joinInProgress = false;
        setStatus('Could not complete the room connection.', 'Join failed');
        showNotification('Join Failed', 'Unable to connect to that room right now.');
        updateActionState();
        return;
    }

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
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    if (!video.dataset.bound) {
        video.addEventListener('loadedmetadata', () => {
            attemptVideoPlayback(video, card);
        });
        video.addEventListener('click', () => attemptVideoPlayback(video, card));
        video.dataset.bound = 'true';
    }

    if (!existingVideo) {
        mediaWrapper.appendChild(video);
    }

    if (!existingCard) {
        videoGrid.append(card);
    }

    updateParticipantLabel(card, label);
    monitorStreamHealth(stream, card, peerId);
    attemptVideoPlayback(video, card);

    peers[peerId] = {
        ...(peers[peerId] || {}),
        card,
        hasLeft: false,
        label,
        streamReceived: true
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

        if (isRoomHost()) {
            shareExistingParticipantsWith(conn.peer);
        }
    });

    conn.on('data', data => {
        if (data?.type === 'intro' && data.name) {
            setParticipantName(conn.peer, data.name);
            if (isRoomHost()) {
                shareExistingParticipantsWith(conn.peer);
            }
            return;
        }

        if (data?.type === 'room-peers' && Array.isArray(data.peers)) {
            data.peers.forEach(participant => {
                if (participant?.peerId) {
                    connectToParticipant(participant.peerId, participant.name || `Peer ${participant.peerId}`);
                }
            });
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
    const shortCodePeer = new Peer(roomCode, PEER_OPTIONS);

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

function registerPeerCall(call, label, options = {}) {
    peers[call.peer] = {
        ...(peers[call.peer] || {}),
        call,
        label,
        hasLeft: false
    };

    monitorPeerConnection(call, label, options.attempt || 0);

    call.on('error', () => {
        if (options.retry) {
            retryPeerCall(call.peer, label, options.attempt || 0, 'call error');
            return;
        }

        setVideoStatus(peers[call.peer]?.card, 'Video connection failed');
    });

    call.on('close', () => {
        const participant = peers[call.peer];
        if (options.retry && !participant?.hasLeft && !participant?.streamReceived) {
            retryPeerCall(call.peer, label, options.attempt || 0, 'early close');
            return;
        }

        handleParticipantLeft(call.peer);
    });
}

function startPeerCall(targetPeerId, label, attempt = 0) {
    if (!targetPeerId || targetPeerId === peer.id || !myStream) {
        return null;
    }

    const call = peer.call(targetPeerId, myStream, {
        metadata: { name: localParticipantName }
    });

    registerPeerCall(call, label, {
        retry: true,
        attempt
    });
    attachRemoteStreamHandler(call, label);
    return call;
}

function attachRemoteStreamHandler(call, label) {
    call.on('stream', userVideoStream => {
        peers[call.peer] = {
            ...(peers[call.peer] || {}),
            streamReceived: true,
            reconnecting: false
        };

        addVideoStream(call.peer, userVideoStream, false, peers[call.peer]?.label || label);
        markRoomJoinComplete(call.peer);
    });
}

function markRoomJoinComplete(peerId) {
    if (meetingMode !== 'join' || peerId !== roomHostId) {
        return;
    }

    joinInProgress = false;
    pendingJoinRoomId = null;
    joinCodeInput.value = '';
    setStatus('Connected to the room.', 'Connected');
    appendSystemMessage('You joined the room successfully.');
    updateActionState();
}

function connectToParticipant(targetPeerId, label) {
    if (!targetPeerId || targetPeerId === peer.id) {
        return;
    }

    const existingParticipant = peers[targetPeerId] || {};
    if (!existingParticipant.call) {
        startPeerCall(targetPeerId, label);
    }

    if (!existingParticipant.connection) {
        const conn = peer.connect(targetPeerId, {
            metadata: { name: localParticipantName }
        });
        setupDataConnection(conn);
    }
}

function monitorPeerConnection(call, label, attempt) {
    setTimeout(() => {
        const peerConnection = call.peerConnection;
        if (!peerConnection || peerConnection._liveChatMonitorBound) {
            return;
        }

        peerConnection._liveChatMonitorBound = true;

        const onStateChange = () => {
            const state = peerConnection.connectionState || peerConnection.iceConnectionState;
            if (!state) {
                return;
            }

            if (['connected', 'completed'].includes(state)) {
                setVideoStatus(peers[call.peer]?.card, '');
                return;
            }

            if (state === 'checking' || state === 'connecting') {
                setVideoStatus(peers[call.peer]?.card, 'Connecting video...');
                return;
            }

            if (state === 'disconnected') {
                setVideoStatus(peers[call.peer]?.card, 'Trying to restore video...');
                setTimeout(() => {
                    const currentState = peerConnection.connectionState || peerConnection.iceConnectionState;
                    if (currentState === 'disconnected') {
                        retryPeerCall(call.peer, label, attempt, 'network disconnected', true);
                    }
                }, 3500);
                return;
            }

            if (state === 'failed') {
                setVideoStatus(peers[call.peer]?.card, 'Reconnecting video...');
                retryPeerCall(call.peer, label, attempt, 'network failed', true);
            }
        };

        peerConnection.addEventListener('iceconnectionstatechange', onStateChange);
        peerConnection.addEventListener('connectionstatechange', onStateChange);
        onStateChange();
    }, 0);
}

function retryPeerCall(peerId, label, attempt, reason, force = false) {
    const participant = peers[peerId] || {};

    if (participant.hasLeft || participant.reconnecting || !myStream) {
        return;
    }

    if (!force && participant.streamReceived) {
        return;
    }

    if (attempt >= MAX_CALL_RETRIES) {
        participant.reconnecting = false;
        setVideoStatus(participant.card, 'Could not load video. Ask them to refresh or rejoin.');
        if (joinInProgress && peerId === roomHostId) {
            joinInProgress = false;
            setStatus('Could not complete the room connection.', 'Join failed');
            updateActionState();
        }
        return;
    }

    peers[peerId] = {
        ...participant,
        streamReceived: false,
        reconnecting: true
    };

    setVideoStatus(participant.card, 'Reconnecting video...');
    appendSystemMessage(`Reconnecting video with ${label} (${reason}).`);

    setTimeout(() => {
        if (peers[peerId]?.hasLeft) {
            return;
        }

        peers[peerId] = {
            ...(peers[peerId] || {}),
            reconnecting: false,
            call: null
        };

        startPeerCall(peerId, label, attempt + 1);
    }, CALL_RETRY_DELAY * (attempt + 1));
}

function attemptVideoPlayback(video, card) {
    const playPromise = video.play();

    if (!playPromise) {
        return;
    }

    playPromise
        .then(() => {
            removeTapToPlay(card);
            setVideoStatus(card, '');
        })
        .catch(() => {
            showTapToPlay(card, video);
        });
}

function showTapToPlay(card, video) {
    if (!card || card.querySelector('.tap-to-play')) {
        return;
    }

    const button = document.createElement('button');
    button.className = 'tap-to-play';
    button.type = 'button';
    button.innerText = 'Tap to show video';
    button.addEventListener('click', () => attemptVideoPlayback(video, card));

    card.querySelector('.video-media')?.appendChild(button);
    setVideoStatus(card, 'Browser paused this video');
}

function removeTapToPlay(card) {
    const button = card?.querySelector('.tap-to-play');
    if (button) {
        button.remove();
    }
}

function monitorStreamHealth(stream, card, peerId) {
    if (!stream || card.dataset.streamId === stream.id) {
        return;
    }

    card.dataset.streamId = stream.id;

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
        setVideoStatus(card, 'No camera video from this device');
        return;
    }

    if (videoTrack.muted) {
        setVideoStatus(card, 'Waiting for video...');
    }

    videoTrack.addEventListener('unmute', () => {
        setVideoStatus(card, '');
    });

    videoTrack.addEventListener('mute', () => {
        setVideoStatus(card, peerId === 'local-user' ? 'Your camera is paused' : 'Waiting for video...');
    });

    videoTrack.addEventListener('ended', () => {
        setVideoStatus(card, peerId === 'local-user' ? 'Your camera stopped' : 'Their camera stopped');
    });
}

function setVideoStatus(card, message) {
    if (!card) {
        return;
    }

    let status = card.querySelector('.video-status');
    if (!message) {
        status?.remove();
        return;
    }

    if (!status) {
        status = document.createElement('div');
        status.className = 'video-status';
        card.querySelector('.video-media')?.appendChild(status);
    }

    status.innerText = message;
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
    return sanitizeName(savedName);
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

function isRoomHost() {
    return roomHostId === peer.id;
}

function shareExistingParticipantsWith(newPeerId) {
    const hostConnection = peers[newPeerId]?.connection;
    if (!hostConnection || !hostConnection.open) {
        return;
    }

    const otherParticipants = Object.entries(peers)
        .filter(([peerId, participant]) => peerId !== 'local-user')
        .filter(([peerId, participant]) => peerId !== newPeerId)
        .filter(([peerId, participant]) => !participant.hasLeft)
        .map(([peerId, participant]) => ({
            peerId,
            name: participant.label || `Peer ${peerId}`
        }));

    hostConnection.send({
        type: 'room-peers',
        peers: otherParticipants
    });
}

function setStatus(text, state) {
    statusText.innerText = text;
    connectionState.innerText = state;
}

function setMeetingMode(mode) {
    meetingMode = mode;

    const isHostMode = mode === 'host';
    hostPanel.classList.toggle('setup-hidden', !isHostMode);
    joinPanel.classList.toggle('setup-hidden', isHostMode);
    joinBtn.classList.toggle('setup-hidden', isHostMode);

    joinBtn.innerText = isHostMode ? 'Ready to Host' : 'Join Room';
    joinBtn.disabled = isHostMode;

    if (isHostMode) {
        setStatus(roomReady ? `Room ${peer.id || '...'} is ready to share.` : 'Preparing your room...', roomReady ? 'Host mode' : 'Starting');
        appendSystemMessage('Host mode selected. Share your room code with others.');
    } else {
        setStatus('Join mode selected. Enter a room code to connect.', 'Join mode');
        appendSystemMessage('Join mode selected. Enter the 6-digit room code and connect.');
    }

    updateActionState();
}

function setHomeMode(mode) {
    meetingMode = mode;
    homeForm.classList.remove('app-hidden');
    homeRoomField.classList.toggle('app-hidden', mode !== 'join');
    homeStartHostBtn.classList.toggle('app-hidden', mode !== 'host');
    homeStartJoinBtn.classList.toggle('app-hidden', mode !== 'join');
    homeHostBtn.classList.toggle('ghost-btn', mode !== 'host');
    homeJoinBtn.classList.toggle('ghost-btn', mode !== 'join');
    homeNameInput.value = homeNameInput.value || localParticipantName;
    homeNameInput.focus();
}

function startHostFromHome() {
    const participantName = sanitizeName(homeNameInput.value);

    if (!participantName) {
        showNotification('Name Required', 'Please enter your name before creating a meeting.');
        homeNameInput.focus();
        return;
    }

    applyParticipantName(participantName);
    enterApp('host');
}

function startJoinFromHome() {
    const participantName = sanitizeName(homeNameInput.value);
    const roomId = homeRoomCodeInput.value.trim();

    if (!participantName) {
        showNotification('Name Required', 'Please enter your name before joining a meeting.');
        homeNameInput.focus();
        return;
    }

    if (!isValidRoomCode(roomId)) {
        showNotification('Invalid Room Code', `Please enter a valid ${ROOM_CODE_LENGTH}-digit room code.`);
        homeRoomCodeInput.focus();
        return;
    }

    applyParticipantName(participantName);
    joinCodeInput.value = roomId;
    pendingJoinRoomId = roomId;
    enterApp('join');
    attemptPendingJoin();
}

function enterApp(mode) {
    homeScreen.classList.add('app-hidden');
    appContent.classList.remove('app-hidden');
    setMeetingMode(mode);
    ensureLocalMedia().catch(() => {});
}

function applyParticipantName(name) {
    localParticipantName = name;
    nameInput.value = name;
    homeNameInput.value = name;
    localStorage.setItem('participant_name', name);
    updateLocalParticipantName(name);
}

function attemptPendingJoin() {
    if (!pendingJoinRoomId || meetingMode !== 'join' || !mediaReady || !roomReady || joinInProgress) {
        return;
    }

    joinCodeInput.value = pendingJoinRoomId;
    joinRoom();
}

function updateActionState() {
    const hasName = sanitizeName(nameInput.value).length > 0;
    const hasJoinCode = isValidRoomCode(joinCodeInput.value.trim());

    joinBtn.disabled = meetingMode !== 'join' || !hasName || !hasJoinCode || !mediaReady || !roomReady || joinInProgress;
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
