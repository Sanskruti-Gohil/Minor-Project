let client = null; // Reused from home.html session
        let localTracks = { videoTrack: null, audioTrack: null };
        let localVideoElement = null;
        let remoteUsers = {};
        let ws = null;
        let isDetecting = false;
        let uid = null;

        const videoContainer = document.getElementById('video_container');
        const subtitle = document.getElementById('subtitle');
        const leaveBtn = document.getElementById('leaveBtn');
        const camBtn = document.getElementById('camBtn');
        const micBtn = document.getElementById('micBtn');
        const detectBtn = document.getElementById('detectBtn');

        console.log("videoContainer:", !!videoContainer);
        console.log("subtitle:", !!subtitle);
        console.log("leaveBtn:", !!leaveBtn);
        console.log("camBtn:", !!camBtn);
        console.log("micBtn:", !!micBtn);
        console.log("detectBtn:", !!detectBtn);

        // Get parameters from URL
        const urlParams = new URLSearchParams(window.location.search);
        uid = urlParams.get('uid');
        const roomName = decodeURIComponent(window.location.pathname.split('/')[2]);

        // Retrieve and validate session state
        const sessionData = JSON.parse(sessionStorage.getItem('signMeetSession') || '{}');
        console.log("Retrieved session data:", sessionData);
        if (!sessionData || sessionData.uid !== uid || sessionData.roomName !== decodeURIComponent(roomName)) {
            console.error("Session mismatch or invalid state. Expected:", { uid, roomName }, "Got:", sessionData);
            alert("Invalid session. Please join again from the home page.");
            window.location.href = "/";
            throw new Error("Session mismatch");
        }
        console.log("Session validated with UID:", uid);

        // WebSocket setup
        ws = new WebSocket('ws://' + window.location.host + '/ws/sign_detection/');
        ws.onopen = () => console.log("WebSocket connected for sign detection");
        ws.onmessage = (event) => {
            const translation = event.data;
            subtitle.textContent = `Translation: ${translation}`;
            console.log("Received translation:", translation);
        };
        ws.onclose = () => console.log("WebSocket connection closed");
        ws.onerror = (error) => console.error("WebSocket error:", error);

        leaveBtn.onclick = async () => {
            console.log("Leave button clicked");
            for (let trackName in localTracks) {
                if (localTracks[trackName]) {
                    localTracks[trackName].stop();
                    localTracks[trackName].close();
                    console.log(`${trackName} stopped and closed`);
                }
            }
            localTracks = { videoTrack: null, audioTrack: null };
            localVideoElement = null;
            if (ws) ws.close();
            videoContainer.innerHTML = '';
            leaveBtn.disabled = true;
            camBtn.disabled = true;
            micBtn.disabled = true;
            detectBtn.disabled = true;
            camBtn.textContent = "Turn On Camera";
            micBtn.textContent = "Turn On Mic";
            subtitle.textContent = "Translation: [None]";
            sessionStorage.removeItem('signMeetSession');
            window.location.href = "/";
            console.log("Left channel and redirected");
        };

        camBtn.onclick = async () => {
            console.log("Camera button clicked");
            if (!localTracks.videoTrack) {
                try {
                    localTracks.videoTrack = await AgoraRTC.createCameraVideoTrack({
                        encoderConfig: { width: 229, height: 229, frameRate: 15, bitrateMin: 300, bitrateMax: 500 }
                    });
                    console.log("Video track created:", localTracks.videoTrack);
                    const videoStreamTrack = localTracks.videoTrack.getMediaStreamTrack();
                    if (videoStreamTrack.readyState !== "live") {
                        console.warn("Video track is not live. ReadyState:", videoStreamTrack.readyState);
                        alert("Video track is not live.");
                        localTracks.videoTrack = null;
                        return;
                    }
                    localVideoElement = document.createElement("video");
                    localVideoElement.id = `user-video-${uid}`;
                    localVideoElement.style.width = "229px";
                    localVideoElement.style.height = "229px";
                    localVideoElement.muted = true;
                    localVideoElement.autoplay = true;
                    videoContainer.appendChild(localVideoElement);
                    const stream = new MediaStream();
                    stream.addTrack(localTracks.videoTrack.getMediaStreamTrack());
                    localVideoElement.srcObject = stream;
                    await localVideoElement.play().catch(err => {
                        console.error("Video play failed:", err);
                        alert("Failed to play video: " + err.message);
                    });
                    console.log("Video element playing, currentTime:", localVideoElement.currentTime);
                    localTracks.videoTrack._videoElement = localVideoElement;
                    await client.publish(localTracks.videoTrack);
                    console.log("Video track published");
                    camBtn.textContent = "Turn Off Camera";
                    detectBtn.disabled = false;
                } catch (err) {
                    console.error("Failed to create or publish video track:", err);
                    alert("Camera access or publish failed: " + err.message);
                    return;
                }
            } else {
                localTracks.videoTrack.setEnabled(!localTracks.videoTrack.enabled);
                camBtn.textContent = localTracks.videoTrack.enabled ? "Turn Off Camera" : "Turn On Camera";
                console.log("Camera toggled, enabled:", localTracks.videoTrack.enabled);
                detectBtn.disabled = !localTracks.videoTrack.enabled;
            }
        };

        micBtn.onclick = async () => {
            console.log("Mic button clicked");
            if (!localTracks.audioTrack) {
                try {
                    localTracks.audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
                    console.log("Audio track created:", localTracks.audioTrack);
                    const audioStreamTrack = localTracks.audioTrack.getMediaStreamTrack();
                    if (audioStreamTrack.readyState !== "live") {
                        console.warn("Audio track is not live. ReadyState:", audioStreamTrack.readyState);
                        alert("Audio track is not live.");
                        localTracks.audioTrack = null;
                        return;
                    }
                    await client.publish(localTracks.audioTrack);
                    console.log("Audio track published");
                    micBtn.textContent = "Turn Off Mic";
                } catch (err) {
                    console.error("Failed to create or publish audio track:", err);
                    alert("Microphone access or publish failed: " + err.message);
                    return;
                }
            } else {
                localTracks.audioTrack.setEnabled(!localTracks.audioTrack.enabled);
                micBtn.textContent = localTracks.audioTrack.enabled ? "Turn Off Mic" : "Turn On Mic";
                console.log("Mic toggled, enabled:", localTracks.audioTrack.enabled);
            }
        };

        detectBtn.onclick = () => {
            console.log("Detect button clicked");
            if (!localTracks.videoTrack || !localTracks.videoTrack._videoElement) {
                alert("No video track or feed available.");
                return;
            }
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                alert("WebSocket connection not established. Try rejoining the call.");
                return;
            }

            if (isDetecting) {
                isDetecting = false;
                detectBtn.textContent = "Detect Sign Language";
                subtitle.textContent = "Translation: [None]";
                console.log("Stopped sign language detection");
                return;
            }

            isDetecting = true;
            detectBtn.textContent = "Stop Detection";
            detectSigns();
        };

        function detectSigns() {
            const videoElement = localTracks.videoTrack._videoElement;

            function captureAndSendFrame() {
                if (!isDetecting) return;

                if (videoElement.readyState < 2 || !cv) {
                    console.warn("Video not ready or OpenCV not loaded, readyState:", videoElement.readyState);
                    setTimeout(captureAndSendFrame, 500);
                    return;
                }

                const canvas = document.createElement('canvas');
                canvas.width = 229;
                canvas.height = 229;
                const context = canvas.getContext('2d');
                context.drawImage(videoElement, 0, 0, 229, 229);

                let imageData = context.getImageData(0, 0, 229, 229);
                let data = imageData.data;

                let rgbData = new Uint8Array(229 * 229 * 3);
                for (let i = 0, j = 0; i < data.length && j < rgbData.length; i += 4, j += 3) {
                    rgbData[j] = data[i];
                    rgbData[j + 1] = data[i + 1];
                    rgbData[j + 2] = data[i + 2];
                }

                console.log(`Sending frame, byte length: ${rgbData.length}`);
                ws.send(rgbData);
                setTimeout(captureAndSendFrame, 500);
            }

            function onOpenCvReady() {
                cv = window.cv;
                console.log("OpenCV loaded");
                captureAndSendFrame();
            }
            if (typeof cv === 'undefined') {
                window.addEventListener('opencv.js', onOpenCvReady);
            } else {
                onOpenCvReady();
            }
        }

        async function handleUserPublished(user, mediaType) {
            console.log("User published:", user.uid, mediaType);
            await client.subscribe(user, mediaType);
            if (mediaType === 'video') {
                const player = document.createElement("div");
                player.id = `remote-user-${user.uid}`;
                player.style.width = "400px";
                player.style.height = "300px";
                videoContainer.appendChild(player);
                user.videoTrack.play(player);
            }
            if (mediaType === 'audio') user.audioTrack.play();
        }

        function handleUserUnpublished(user) {
            console.log("User unpublished:", user.uid);
            const player = document.getElementById(`remote-user-${user.uid}`);
            if (player) player.remove();
        }