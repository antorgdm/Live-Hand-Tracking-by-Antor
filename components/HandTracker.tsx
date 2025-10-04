
import React, { useState, useEffect, useRef } from 'react';
import {
  HandLandmarker,
  FilesetResolver,
  DrawingUtils
} from '@mediapipe/tasks-vision';
import Spinner from './Spinner';
import { CameraIcon, CameraOffIcon } from './Icons';

const FINGER_MAPPING = [
  { name: 'Thumb', tipIndex: 4 },
  { name: 'Index', tipIndex: 8 },
  { name: 'Middle', tipIndex: 12 },
  { name: 'Ring', tipIndex: 16 },
  { name: 'Pinky', tipIndex: 20 },
];

// --- Gesture Recognition Logic ---
const getDistance = (p1, p2) => {
    // Only uses x and y for 2D canvas distance, sufficient for this gesture detection
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

const recognizeGesture = (landmarks) => {
    if (!landmarks || landmarks.length === 0) return null;

    // Key landmarks
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    
    const indexMcp = landmarks[5];
    const pinkyMcp = landmarks[17];
    const palmCenter = landmarks[9]; // Using middle finger MCP as an approximate palm center

    // Normalize distances by hand size (width of the palm) to make detection scale-invariant
    const handSize = getDistance(indexMcp, pinkyMcp);
    if (handSize < 0.05) return null; // Avoid errors if hand is not detected properly

    const indexDist = getDistance(indexTip, palmCenter) / handSize;
    const middleDist = getDistance(middleTip, palmCenter) / handSize;
    const ringDist = getDistance(ringTip, palmCenter) / handSize;
    const pinkyDist = getDistance(pinkyTip, palmCenter) / handSize;

    // Gesture: Pointing (most specific, check first)
    if (
        indexDist > 0.6 &&   // Index finger is extended
        middleDist < 0.4 &&  // Middle is curled
        ringDist < 0.4 &&    // Ring is curled
        pinkyDist < 0.45     // Pinky is curled (often curls less than others)
    ) {
        return 'Pointing';
    }

    // Gesture: Open Palm
    if (
        indexDist > 0.6 &&
        middleDist > 0.6 &&
        ringDist > 0.6 &&
        pinkyDist > 0.6
    ) {
        return 'Open Palm';
    }

    // Gesture: Fist
    if (
        indexDist < 0.35 &&
        middleDist < 0.35 &&
        ringDist < 0.35 &&
        pinkyDist < 0.35
    ) {
        return 'Fist';
    }
    
    return null;
};


const HandTracker: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const gesturesRef = useRef<(string | null)[]>([]);
  
  // Initialize HandLandmarker
  useEffect(() => {
    const createHandLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        const newHandLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });
        handLandmarkerRef.current = newHandLandmarker;
        setIsLoading(false);
      } catch (e) {
        if (e instanceof Error) {
            setError(`Failed to initialize model: ${e.message}`);
        } else {
            setError('An unknown error occurred during initialization.');
        }
        setIsLoading(false);
      }
    };
    createHandLandmarker();

    // Cleanup
    return () => {
      handLandmarkerRef.current?.close();
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, []);

  const predictWebcam = () => {
    if (!videoRef.current || !canvasRef.current || !handLandmarkerRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    
    if (video.readyState < 2 || !canvasCtx) {
      animationFrameIdRef.current = requestAnimationFrame(predictWebcam);
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    
    const startTimeMs = performance.now();
    const results = handLandmarkerRef.current.detectForVideo(video, startTimeMs);
    
    // Recognize gestures and store them in a ref to avoid re-renders
    const newGestures: (string | null)[] = [];
    if (results.landmarks) {
        for (const landmarks of results.landmarks) {
            const gesture = recognizeGesture(landmarks);
            newGestures.push(gesture);
        }
        gesturesRef.current = newGestures;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    const drawingUtils = new DrawingUtils(canvasCtx);

    if (results.landmarks) {
      results.landmarks.forEach((landmarks, index) => {
        const gesture = gesturesRef.current[index];

        // --- Animate Connectors on "Fist" gesture ---
        const baseConnectorColor = '#06b6d4'; // cyan-500
        let connectorColor = baseConnectorColor;
        let connectorWidth = 5;

        if (gesture === 'Fist') {
            const pulseFactor = (Math.sin(performance.now() / 150) + 1) / 2; // Oscillates between 0 and 1
            connectorWidth = 5 + pulseFactor * 3;
            // HSL for #06b6d4 is hsl(190, 95%, 43%). We'll brighten it up.
            connectorColor = `hsl(190, 95%, ${43 + pulseFactor * 15}%)`;
        }
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
          color: connectorColor,
          lineWidth: connectorWidth,
        });

        // --- Custom Landmark Drawing with Depth Effect ---
        const minZ = Math.min(...landmarks.map(l => l.z));
        const maxZ = Math.max(...landmarks.map(l => l.z));
        landmarks.forEach(landmark => {
            const zRange = maxZ - minZ;
            // A smaller z is closer to the camera. We want closer points to be brighter/bigger.
            const intensity = 1 - (landmark.z - minZ) / (zRange || 1);
            
            const lightness = 60 + intensity * 25; // Varies from 60% to 85%
            const radius = 3 + intensity * 4; // Varies from 3px to 7px
            const color = `hsl(187, 91%, ${lightness}%)`; // cyan-300 base color

            const x = landmark.x * canvas.width;
            const y = landmark.y * canvas.height;
            
            canvasCtx.fillStyle = color;
            canvasCtx.beginPath();
            canvasCtx.arc(x, y, radius, 0, 2 * Math.PI);
            canvasCtx.fill();
        });

        // --- Animate Fingertips on "Open Palm" or "Pointing" gesture ---
        const isPalmOpen = gesture === 'Open Palm';
        const isPointing = gesture === 'Pointing';
        if (isPalmOpen || isPointing) {
            const pulseFactor = (Math.sin(performance.now() / 200) + 1) / 2;
            const glowRadius = 15 + pulseFactor * 10;
            const glowAlpha = 0.4 - pulseFactor * 0.2;
            const glowColor = `rgba(103, 232, 249, ${glowAlpha})`;
            
            // Glow all fingertips for Open Palm, only Index for Pointing
            const fingersToGlow = isPalmOpen ? FINGER_MAPPING : FINGER_MAPPING.filter(f => f.name === 'Index');

            fingersToGlow.forEach(finger => {
                const landmark = landmarks[finger.tipIndex];
                if (landmark) {
                    const x = landmark.x * canvas.width;
                    const y = landmark.y * canvas.height;
                    
                    const grd = canvasCtx.createRadialGradient(x, y, 0, x, y, glowRadius);
                    grd.addColorStop(0.3, glowColor);
                    grd.addColorStop(1, 'rgba(103, 232, 249, 0)');

                    canvasCtx.fillStyle = grd;
                    canvasCtx.beginPath();
                    canvasCtx.arc(x, y, glowRadius, 0, 2 * Math.PI);
                    canvasCtx.fill();
                }
            });
        }

        // Draw finger names
        canvasCtx.font = '600 14px system-ui, sans-serif';
        canvasCtx.textAlign = 'center';
        canvasCtx.textBaseline = 'middle';
        
        FINGER_MAPPING.forEach(finger => {
          const landmark = landmarks[finger.tipIndex];
          if (landmark) {
            const x = landmark.x * canvas.width;
            const y = landmark.y * canvas.height;
            const text = finger.name;

            const textMetrics = canvasCtx.measureText(text);
            const padding = 5;
            const boxWidth = textMetrics.width + padding * 2;
            const boxHeight = 22;
            const textYOffset = -24;
            const boxYOffset = -35;
            
            // Save the context state before transforming it for the text
            canvasCtx.save();
            
            // Translate the origin to the landmark's x position, but keep the y
            canvasCtx.translate(x, y);
            // Flip the context horizontally to counteract the CSS flip
            canvasCtx.scale(-1, 1);
            
            // Draw background, centered horizontally around the new origin (0)
            canvasCtx.fillStyle = 'rgba(15, 23, 42, 0.7)';
            canvasCtx.beginPath();
            canvasCtx.roundRect(-boxWidth / 2, boxYOffset, boxWidth, boxHeight, 8);
            canvasCtx.fill();
            
            // Draw the text, centered at the new origin (0)
            canvasCtx.fillStyle = '#e2e8f0';
            canvasCtx.fillText(text, 0, textYOffset);
            
            // Restore the context to its original state for the next landmark
            canvasCtx.restore();
          }
        });
        
        // --- Display Detected Gesture ---
        if (gesture) {
            const text = gesture;
            canvasCtx.font = 'bold 22px system-ui, sans-serif';
            canvasCtx.textBaseline = 'middle';

            const textMetrics = canvasCtx.measureText(text);
            const padding = 10;
            const boxWidth = textMetrics.width + padding * 2;
            const boxHeight = 40;
            const isFirstHand = (index === 0);

            const boxEdgeMargin = 20;
            const boxY = 20;

            // Calculate the center of the text box
            const textX = isFirstHand 
                ? boxEdgeMargin + boxWidth / 2 
                : canvas.width - boxEdgeMargin - boxWidth / 2;
            const textY = boxY + boxHeight / 2;

            // Save the context state
            canvasCtx.save();
            
            // Translate to the center of where the text should be
            canvasCtx.translate(textX, textY);
            // Flip the context
            canvasCtx.scale(-1, 1);

            // Draw background, centered around the new origin (0, 0)
            canvasCtx.fillStyle = 'rgba(15, 23, 42, 0.75)';
            canvasCtx.beginPath();
            canvasCtx.roundRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, 12);
            canvasCtx.fill();

            // Draw text, centered at the new origin (0, 0)
            canvasCtx.textAlign = 'center'; // Ensure it's centered
            canvasCtx.fillStyle = '#e2e8f0';
            canvasCtx.fillText(text, 0, 0);

            // Restore context
            canvasCtx.restore();
        }
      });
    }
    canvasCtx.restore();
    
    if (isTracking) {
        animationFrameIdRef.current = requestAnimationFrame(predictWebcam);
    }
  };
  
  useEffect(() => {
    if (isTracking) {
      predictWebcam();
    } else {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      if (canvasRef.current) {
        const canvasCtx = canvasRef.current.getContext('2d');
        canvasCtx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTracking]);

  const handleToggleTracking = async () => {
    if (isLoading || !handLandmarkerRef.current) return;

    if (isTracking) {
      setIsTracking(false);
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    } else {
      try {
        setError(null);
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.addEventListener('loadedmetadata', () => {
            videoRef.current?.play();
            setIsTracking(true);
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("Webcam access was denied. Please allow camera access in your browser settings and refresh the page.");
        } else if (err instanceof Error) {
          setError(`Error accessing webcam: ${err.message}`);
        } else {
          setError('An unknown error occurred while accessing the webcam.');
        }
        setIsTracking(false);
      }
    }
  };

  const buttonText = isLoading ? 'Loading Model...' : isTracking ? 'Stop Tracking' : 'Start Tracking';

  return (
    <div className="w-full max-w-4xl flex flex-col items-center p-4 sm:p-6 bg-slate-800/50 rounded-2xl shadow-2xl border border-slate-700">
      <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-slate-900 flex items-center justify-center">
        {(isLoading || !isTracking) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center p-4">
            {isLoading ? (
                <>
                <Spinner />
                <p className="mt-4 text-slate-300">Initializing Hand Tracking Model...</p>
                </>
            ) : error ? (
                <>
                <p className="text-xl font-semibold text-red-400">Error</p>
                <p className="text-slate-300 mt-2 max-w-md">{error}</p>
                </>
            ) : (
                <>
                <CameraIcon className="w-16 h-16 text-slate-500 mb-4" />
                <h2 className="text-xl font-semibold text-slate-200">Ready to Track</h2>
                <p className="text-slate-400 mt-2 max-w-sm">Enable your webcam to see real-time hand landmark detection.</p>
                </>
            )}
            </div>
        )}
        <video 
          ref={videoRef} 
          className={`w-full h-full object-cover transform -scale-x-100 transition-opacity duration-300 ${isTracking ? 'opacity-100' : 'opacity-0'}`}
          autoPlay 
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full transform -scale-x-100" />
      </div>
      <div className="mt-6 flex items-center justify-center">
        <button
          onClick={handleToggleTracking}
          disabled={isLoading}
          className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold rounded-full shadow-lg hover:from-cyan-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-cyan-400 transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-3 text-lg"
        >
          {isTracking ? <CameraOffIcon className="w-6 h-6"/> : <CameraIcon className="w-6 h-6"/>}
          <span>{buttonText}</span>
        </button>
      </div>
    </div>
  );
};
export default HandTracker;