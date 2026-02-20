// PeerJS setup
const peer = new Peer(); 
let myStream;
const peers = {}; 
const connections = []; 

// DOM Elements
const videoGrid = document.getElementById('video-grid');
const roomCodeSpan = document.getElementById('room-code');
const chatBox = document.getElementById('chat-box');
const msgInput = document.getElementById('msg-input');

// Apni media access karna
navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
    myStream = stream;
    addVideoStream(document.createElement('video'), stream, true);

    // Jab koi aur call kare
    peer.on('call', call => {
        call.answer(stream); // Call answer karo apni stream ke sath
        const video = document.createElement('video');
        call.on('stream', userVideoStream => {
            addVideoStream(video, userVideoStream);
        });
    });
});

// Peer connect hone par ID dikhana
peer.on('open', id => {
    roomCodeSpan.innerText = id;
});

// Incoming chat connections handle karna
peer.on('connection', conn => {
    setupDataConnection(conn);
});

// Kisi ki room me join karna
document.getElementById('join-btn').addEventListener('click', () => {
    const roomId = document.getElementById('join-code').value;
    if(roomId) {
        // Video Call connect karna
        const call = peer.call(roomId, myStream);
        const video = document.createElement('video');
        call.on('stream', userVideoStream => {
            addVideoStream(video, userVideoStream);
        });

        // Chat connection banana
        const conn = peer.connect(roomId);
        setupDataConnection(conn);
    }
});

// Chat Send karna
document.getElementById('send-btn').addEventListener('click', () => {
    const text = msgInput.value;
    if(text === '') return;
    
    appendMessage("You", text);
    saveChatToLocal("You: " + text);
    
    // Sabhi connected peers ko message bhejna
    connections.forEach(conn => conn.send(text));
    msgInput.value = '';
});

// Video grid me video add karna
function addVideoStream(video, stream, muted = false) {
    video.srcObject = stream;
    video.muted = muted; // Khud ki aawaz khud ko na aaye
    video.addEventListener('loadedmetadata', () => {
        video.play();
    });
    videoGrid.append(video);
}

// Data channel (Chat) setup
function setupDataConnection(conn) {
    connections.push(conn);
    conn.on('data', data => {
        appendMessage("Peer", data);
        saveChatToLocal("Peer: " + data);
    });
}

// UI me message dikhana
function appendMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg';
    msgDiv.innerText = `${sender}: ${text}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Media Controls (Mute / Video Off)
document.getElementById('mute-btn').addEventListener('click', (e) => {
    const audioTrack = myStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    e.target.innerText = audioTrack.enabled ? "Mute Audio" : "Unmute Audio";
});

document.getElementById('video-btn').addEventListener('click', (e) => {
    const videoTrack = myStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    e.target.innerText = videoTrack.enabled ? "Turn Off Video" : "Turn On Video";
});

// --- LOCAL STORAGE & AUTO DOWNLOAD LOGIC ---
const STORAGE_LIMIT = 50000; // Limit in characters (50KB approx). Ise test ke liye chota rakha hai.

function saveChatToLocal(msg) {
    let chats = JSON.parse(localStorage.getItem('room_chats') || '[]');
    chats.push(msg);
    let chatString = JSON.stringify(chats);

    // Agar storage limit cross ho rahi hai
    if (chatString.length > STORAGE_LIMIT) {
        downloadChatHistory(chatString);
        localStorage.removeItem('room_chats'); // Storage clear karo
    } else {
        localStorage.setItem('room_chats', chatString);
    }
}

function downloadChatHistory(data) {
    // JSON array format se clean text me convert karna
    const chatArray = JSON.parse(data);
    const textData = chatArray.join('\n');
    
    const blob = new Blob([textData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `Chat_Backup_${new Date().getTime()}.txt`;
    a.click();
    
    URL.revokeObjectURL(url);
    alert("Chat storage full! History downloaded aur clear kar di gayi hai.");
}