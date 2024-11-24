/**
 * Running a local relay server will allow you to hide your API key
 * and run custom logic on the server
 *
 * Set the local relay server address to:
 * REACT_APP_LOCAL_RELAY_SERVER_URL=http://localhost:8081
 *
 * This will also require you to set OPENAI_API_KEY= in a `.env` file
 * You can run it with `npm run relay`, in parallel with `npm start`
 */
const LOCAL_RELAY_SERVER_URL: string =
  process.env.REACT_APP_LOCAL_RELAY_SERVER_URL || '';

import { useEffect, useRef, useCallback, useState } from 'react';
import axiosInstance from '../axiosConfig';

import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { WavRecorder, WavStreamPlayer } from '../lib/wavtools/index.js';
import { instructions } from '../utils/conversation_config.js';
import { WavRenderer } from '../utils/wav_renderer';

import { X, Edit, Zap, ArrowUp, ArrowDown } from 'react-feather';
import { Button } from '../components/button/Button';
import { Toggle } from '../components/toggle/Toggle';
import { Map } from '../components/Map';

import './ConsolePage.scss';
import { isJsxOpeningLikeElement } from 'typescript';
import visyfyLogo from '../assets/visyfy_logo.png';
import rippleAnimationBlack from '../assets/ripple_animation_black.svg';


/**
 * Type for result from get_weather() function call
 */
interface Coordinates {
  lat: number;
  lng: number;
  location?: string;
  temperature?: {
    value: number;
    units: string;
  };
  wind_speed?: {
    value: number;
    units: string;
  };
}

/**
 * Type for all event logs
 */
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  count?: number;
  event: { [key: string]: any };
}

interface UsageTotal {
  input_audio_tokens: number;
  output_audio_tokens: number;
  input_text_tokens: number;
  output_text_tokens: number;
  cost: number;
}

export function ConsolePage() {
  /**
   * Ask user for API Key
   * If we're using the local relay server, we don't need this
   */
  const apiKey = LOCAL_RELAY_SERVER_URL
    ? ''
    : localStorage.getItem('tmp::voice_api_key') ||
    prompt('OpenAI API Key') ||
    '';
  if (apiKey !== '') {
    localStorage.setItem('tmp::voice_api_key', apiKey);
  }

  /**
   * Instantiate:
   * - WavRecorder (speech input)
   * - WavStreamPlayer (speech output)
   * - RealtimeClient (API client)
   */
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const wavStreamPlayerRef = useRef<WavStreamPlayer>(
    new WavStreamPlayer({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient(
      LOCAL_RELAY_SERVER_URL
        ? { url: LOCAL_RELAY_SERVER_URL }
        : {
          apiKey: apiKey,
          dangerouslyAllowAPIKeyInBrowser: true,
        }
    )
  );

  /**
   * References for
   * - Rendering audio visualization (canvas)
   * - Autoscrolling event logs
   * - Timing delta for event log displays
   */
  const clientCanvasRef = useRef<HTMLCanvasElement>(null);
  const serverCanvasRef = useRef<HTMLCanvasElement>(null);
  const eventsScrollHeightRef = useRef(0);
  const eventsScrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<string>(new Date().toISOString());

  /**
   * All of our variables for displaying application state
   * - items are all conversation items (dialog)
   * - realtimeEvents are event logs, which can be expanded
   * - memoryKv is for set_memory() function
   * - coords, marker are for get_weather() function
   */
  const [items, setItems] = useState<ItemType[]>([]);
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<{
    [key: string]: boolean;
  }>({});
  const [isConnected, setIsConnected] = useState(false);
  const [canPushToTalk, setCanPushToTalk] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [memoryKv, setMemoryKv] = useState<{ [key: string]: any }>({});
  const [coords, setCoords] = useState<Coordinates | null>({
    lat: 37.775593,
    lng: -122.418137,
  });
  const [marker, setMarker] = useState<Coordinates | null>(null);
  const [defaultView, setConversationView] = useState<boolean>(false);
  const [visyfyIconHovered, setVisyfyIconHovered] = useState(false);

  const [usage, setUsage] = useState<UsageTotal>({
    input_audio_tokens: 0,
    output_audio_tokens: 0,
    input_text_tokens: 0,
    output_text_tokens: 0,
    cost: 0,
  });

  /**
   * Utility for formatting the timing of logs
   */
  const formatTime = useCallback((timestamp: string) => {
    const startTime = startTimeRef.current;
    const t0 = new Date(startTime).valueOf();
    const t1 = new Date(timestamp).valueOf();
    const delta = t1 - t0;
    const hs = Math.floor(delta / 10) % 100;
    const s = Math.floor(delta / 1000) % 60;
    const m = Math.floor(delta / 60_000) % 60;
    const pad = (n: number) => {
      let s = n + '';
      while (s.length < 2) {
        s = '0' + s;
      }
      return s;
    };
    return `${pad(m)}:${pad(s)}.${pad(hs)}`;
  }, []);

  /**
   * When you click the API key
   */
  const resetAPIKey = useCallback(() => {
    const apiKey = prompt('OpenAI API Key');
    if (apiKey !== null) {
      localStorage.clear();
      localStorage.setItem('tmp::voice_api_key', apiKey);
      window.location.reload();
    }
  }, []);

  /**
   * Connect to conversation:
   * WavRecorder taks speech input, WavStreamPlayer output, client is API client
   */
  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;

    // Set state variables
    startTimeRef.current = new Date().toISOString();
    setIsConnected(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());

    // Connect to microphone
    await wavRecorder.begin();

    // Connect to audio output
    await wavStreamPlayer.connect();

    // Connect to realtime API
    await client.connect();
    client.sendUserMessageContent([
      {
        type: `input_text`,
        // text: `Hello!`,
        text: `Your job is to ask the case phone number, and then communicate back and forth with the user while they ask questions about the case. 
        Your first message to the client should be a kind greeting, asking them how they are doing. When you get their phone number, remember to save it in memory to use in the future`
      },
    ]);

    if (client.getTurnDetectionType() === 'server_vad') {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
  }, []);

  /**
   * Disconnect and reset conversation state
   */
  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setRealtimeEvents([]);
    setItems([]);
    setMemoryKv({});
    setCoords({
      lat: 37.775593,
      lng: -122.418137,
    });
    setMarker(null);

    setUsage({
      input_audio_tokens: 0,
      output_audio_tokens: 0,
      input_text_tokens: 0,
      output_text_tokens: 0,
      cost: 0,
    });

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();

    const wavStreamPlayer = wavStreamPlayerRef.current;
    await wavStreamPlayer.interrupt();
  }, []);

  const deleteConversationItem = useCallback(async (id: string) => {
    const client = clientRef.current;
    client.deleteItem(id);
  }, []);

  /**
   * In push-to-talk mode, start recording
   * .appendInputAudio() for each sample
   */
  const startRecording = async () => {
    setIsRecording(true);
    if (!isConnected || !canPushToTalk) {
      return;
    }
    setIsRecording(true);
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const trackSampleOffset = await wavStreamPlayer.interrupt();
    if (trackSampleOffset?.trackId) {
      const { trackId, offset } = trackSampleOffset;
      await client.cancelResponse(trackId, offset);
    }
    await wavRecorder.record((data) => client.appendInputAudio(data.mono));
  };

  /**
   * In push-to-talk mode, stop recording
   */
  const stopRecording = async () => {
    setIsRecording(false);
    if (!isConnected || !canPushToTalk) {
      return;
    }
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.pause();
    client.createResponse();
  };

  /**
   * Switch between Manual <> VAD mode for communication
   */
  const changeTurnEndType = async (value: string) => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;
    if (value === 'none' && wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }
    client.updateSession({
      turn_detection: value === 'none' ? null : { type: 'server_vad' },
    });
    if (value === 'server_vad' && client.isConnected()) {
      await wavRecorder.record((data) => client.appendInputAudio(data.mono));
    }
    setCanPushToTalk(value === 'none');
  };

  /**
   * Auto-scroll the event logs
   */
  useEffect(() => {
    if (eventsScrollRef.current) {
      const eventsEl = eventsScrollRef.current;
      const scrollHeight = eventsEl.scrollHeight;
      // Only scroll if height has just changed
      if (scrollHeight !== eventsScrollHeightRef.current) {
        eventsEl.scrollTop = scrollHeight;
        eventsScrollHeightRef.current = scrollHeight;
      }
    }
  }, [realtimeEvents]);

  /**
   * Auto-scroll the conversation logs
   */
  useEffect(() => {
    const conversationEls = [].slice.call(
      document.body.querySelectorAll('[data-conversation-content]')
    );
    for (const el of conversationEls) {
      const conversationEl = el as HTMLDivElement;
      conversationEl.scrollTop = conversationEl.scrollHeight;
    }
  }, [items]);

  /**
   * Set up render loops for the visualization canvas
   */
  useEffect(() => {
    let isLoaded = true;

    const wavRecorder = wavRecorderRef.current;
    const clientCanvas = clientCanvasRef.current;
    let clientCtx: CanvasRenderingContext2D | null = null;

    const wavStreamPlayer = wavStreamPlayerRef.current;
    const serverCanvas = serverCanvasRef.current;
    let serverCtx: CanvasRenderingContext2D | null = null;

    const render = () => {
      if (isLoaded) {
        if (clientCanvas) {
          if (!clientCanvas.width || !clientCanvas.height) {
            clientCanvas.width = clientCanvas.offsetWidth;
            clientCanvas.height = clientCanvas.offsetHeight;
          }
          clientCtx = clientCtx || clientCanvas.getContext('2d');
          if (clientCtx) {
            clientCtx.clearRect(0, 0, clientCanvas.width, clientCanvas.height);
            const result = wavRecorder.recording
              ? wavRecorder.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              clientCanvas,
              clientCtx,
              result.values,
              '#0099ff',
              10,
              0,
              8
            );
          }
        }
        if (serverCanvas) {
          if (!serverCanvas.width || !serverCanvas.height) {
            serverCanvas.width = serverCanvas.offsetWidth;
            serverCanvas.height = serverCanvas.offsetHeight;
          }
          serverCtx = serverCtx || serverCanvas.getContext('2d');
          if (serverCtx) {
            serverCtx.clearRect(0, 0, serverCanvas.width, serverCanvas.height);
            const result = wavStreamPlayer.analyser
              ? wavStreamPlayer.getFrequencies('voice')
              : { values: new Float32Array([0]) };
            WavRenderer.drawBars(
              serverCanvas,
              serverCtx,
              result.values,
              '#009900',
              10,
              0,
              8
            );
          }
        }
        window.requestAnimationFrame(render);
      }
    };
    render();

    return () => {
      isLoaded = false;
    };
  }, []);

  /**
   * Core RealtimeClient and audio capture setup
   * Set all of our instructions, tools, events and more
   */
  useEffect(() => {
    // Get refs
    const wavStreamPlayer = wavStreamPlayerRef.current;
    const client = clientRef.current;

    // Set instructions
    client.updateSession({ instructions: instructions });
    // Set transcription, otherwise we don't get user transcriptions back
    client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });

    // Add tools
    client.addTool(
      {
        name: 'set_memory',
        description: 'Saves important data about the user into memory.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description:
                'The key of the memory value. Always use lowercase and underscores, no other characters.',
            },
            value: {
              type: 'string',
              description: 'Value can be anything represented as a string',
            },
          },
          required: ['key', 'value'],
        },
      },
      async ({ key, value }: { [key: string]: any }) => {
        setMemoryKv((memoryKv) => {
          const newKv = { ...memoryKv };
          newKv[key] = value;
          return newKv;
        });
        return { ok: true };
      }
    );
    client.addTool(
      {
        name: 'get_weather',
        description:
          'Retrieves the weather for a given lat, lng coordinate pair. Specify a label for the location.',
        parameters: {
          type: 'object',
          properties: {
            lat: {
              type: 'number',
              description: 'Latitude',
            },
            lng: {
              type: 'number',
              description: 'Longitude',
            },
            location: {
              type: 'string',
              description: 'Name of the location',
            },
          },
          required: ['lat', 'lng', 'location'],
        },
      },
      async ({ lat, lng, location }: { [key: string]: any }) => {
        setMarker({ lat, lng, location });
        setCoords({ lat, lng, location });
        const result = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m`
        );
        const json = await result.json();
        const temperature = {
          value: json.current.temperature_2m as number,
          units: json.current_units.temperature_2m as string,
        };
        const wind_speed = {
          value: json.current.wind_speed_10m as number,
          units: json.current_units.wind_speed_10m as string,
        };
        setMarker({ lat, lng, location, temperature, wind_speed });
        return json;
      }
    );

    client.addTool(
      {
        name: 'send_message_to_case',
        description:
          'Sends a user question to a case, logs it, retrieves an AI response, and logs the response.',
        parameters: {
          type: 'object',
          properties: {
            phone_number: {
              type: 'string',
              description: 'The Phone number of the case to interact with.',
            },
            question: {
              type: 'string',
              description: 'The question to ask the case.',
            },
          },
          required: ['case_id', 'question'],
        },
      },
      async ({ phone_number, question, location }: { [key: string]: any }) => {
        if (!question || !phone_number) {
          throw new Error('Both Phone Number and question are required.');
        }
    
        try {
          let response = await axiosInstance.post('/vLaw/chat_with_case', {
            prompt: "User Input: `" + question,
            phone_number: phone_number
          });
          // Check the API response for errors
          const aiResponse = response?.data?.data?.text_response;
          if (response?.data?.x !== 200 || aiResponse === 'An error occurred') {
            throw new Error('Failed to process the message.');
          }
    
          // Return the AI response
          return {
            question,
            aiResponse
          };
        } catch (error) {
          console.error('Error in send_message_to_case:', error);
          throw error; // Re-throw the error to the caller
        }
      }
    );
    

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
      if (realtimeEvent.event.type === 'response.done') {
        setUsage((usage) => {
          const u = realtimeEvent.event.response.usage;
          const input_audio_tokens = u.input_token_details.audio_tokens;
          const output_audio_tokens = u.output_token_details.audio_tokens;
          const input_text_tokens = u.input_token_details.text_tokens;
          const output_text_tokens = u.output_token_details.text_tokens;

          const currentCost = input_audio_tokens * 100 / 1000000 +
            output_audio_tokens * 200 / 1000000 +
            input_text_tokens * 5 / 1000000 +
            output_text_tokens * 20 / 1000000;

          return {
            output_audio_tokens: usage.output_audio_tokens + output_audio_tokens,
            input_audio_tokens: usage.input_audio_tokens + input_audio_tokens,
            output_text_tokens: usage.output_text_tokens + output_text_tokens,
            input_text_tokens: usage.input_text_tokens + input_text_tokens,
            cost: usage.cost + currentCost
          }
        })
      }
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      const trackSampleOffset = await wavStreamPlayer.interrupt();
      if (trackSampleOffset?.trackId) {
        const { trackId, offset } = trackSampleOffset;
        await client.cancelResponse(trackId, offset);
      }
    });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (delta?.audio) {
        wavStreamPlayer.add16BitPCM(delta.audio, item.id);
      }
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, []);

  /**
   * Render the application
   */
  return (
    <div data-component="ConsolePage">
      <div
        className="content-top"
        style={{
          backgroundColor: "black",
        }}
      >
        <div
          className="content-title"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100px",
            backgroundColor: "black",
          }}
        >
          <span style={{ fontWeight: "bold", fontSize: "24px" }}>Visyfy</span>

        </div>
        <div className="content-actions">
          <Toggle
            defaultValue={false}
            labels={['Push to Talk', 'Auto Detect Voice']}
            values={['none', 'server_vad']}
            onChange={(_, value) => changeTurnEndType(value)}

          />
          <div className="spacer" />
        </div>

      </div>
      {!defaultView &&
        <div
          className="content-title"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "calc(100% - 100px)",
            background: !canPushToTalk && isConnected
              ? `url(${rippleAnimationBlack}) no-repeat center center` // Set SVG as background when conditions are met
              : undefined, // No background otherwise
            backgroundSize: !canPushToTalk && isConnected ? "cover" : undefined,
            backgroundColor: !(!canPushToTalk && isConnected) // Set black background only if no SVG background
              ? "black"
              : undefined,
          }}
        >{isConnected && (
          <div
            style={{
              display: "flex",
              flexDirection: "column", // Stack items vertically
              alignItems: "center", // Center-align items horizontally
              gap: "20px", // Space between the image and the button
            }}
          >
            <div
              style={{
                display: "inline-block",
                borderRadius: "50%",
                boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",
                overflow: "hidden",
                width: "400px",
                height: "400px",
                cursor: !isConnected || !canPushToTalk ? "" : "pointer",
                background: isRecording
                  ? `url(${rippleAnimationBlack}) no-repeat center center`
                  : visyfyIconHovered
                    ? "#222222" // Grey hover effect
                    : undefined,
                backgroundSize: isRecording || visyfyIconHovered ? "cover" : undefined,
              }}
              onMouseEnter={() => {
                if (canPushToTalk) setVisyfyIconHovered(true);
              }}
              onMouseLeave={() => {
                if (canPushToTalk) setVisyfyIconHovered(false);
              }}
            >
              <img
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                src={visyfyLogo}
                alt="Visyfy logo"
                style={{ height: "100%", width: "100%", objectFit: "cover" }}
              />
            </div>

            <div
              ref={eventsScrollRef}
              style={{
                maxHeight: "300px",
                maxWidth: "500px",
                overflow: "auto",
                color: "#6e6e7f",
                position: "relative",
                flexGrow: 1,
                padding: "8px 0",
                paddingTop: "4px",
                lineHeight: "1.2em",
              }}
            >
              {!realtimeEvents.length && `awaiting connection...`}
              {realtimeEvents.map((realtimeEvent, i) => {
                const count = realtimeEvent.count;
                const event = { ...realtimeEvent.event };
                if (event.type === 'input_audio_buffer.append') {
                  event.audio = `[trimmed: ${event.audio.length} bytes]`;
                } else if (event.type === 'response.audio.delta') {
                  event.delta = `[trimmed: ${event.delta.length} bytes]`;
                }
                return (
                  <div className="event" key={event.event_id}>
                    <div className="event-timestamp">
                      {formatTime(realtimeEvent.time)}
                    </div>
                    <div className="event-details">
                      <div
                        className="event-summary"
                        onClick={() => {
                          // toggle event details
                          const id = event.event_id;
                          const expanded = { ...expandedEvents };
                          if (expanded[id]) {
                            delete expanded[id];
                          } else {
                            expanded[id] = true;
                          }
                          setExpandedEvents(expanded);
                        }}
                      >
                        <div
                          className={`event-source ${event.type === 'error'
                            ? 'error'
                            : realtimeEvent.source
                            }`}
                          style={{ color: 'white' }}

                        >
                          {realtimeEvent.source === 'client' ? (
                            <ArrowUp />
                          ) : (
                            <ArrowDown />
                          )}
                          <span style={{ color: 'white' }} >
                            {event.type === 'error'
                              ? 'error!'
                              : realtimeEvent.source}
                          </span>
                        </div>
                        <div style={{ color: 'white' }} className="event-type">
                          {event.type}
                          {count && ` (${count})`}
                        </div>
                      </div>
                      {!!expandedEvents[event.event_id] && (
                        <div className="event-payload" style={{ color: 'white' }} >
                          {JSON.stringify(event, null, 2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button
              label={isConnected ? "disconnect" : "connect"}
              iconPosition={isConnected ? "end" : "start"}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? "regular" : "action"}
              onClick={isConnected ? disconnectConversation : connectConversation}
              style={{
                fontSize: "20px", // Larger text
                padding: "16px 22px", // Larger padding
                backgroundColor: "black", // Black background
                color: "blue", // Blue text
                border: "2px solid blue", // Blue outline
                borderRadius: "8px", // Optional: rounded corners
                cursor: "pointer", // Pointer cursor for better UX
              }}
            />

          </div>
        )}


          {!isConnected &&
            <Button
              label={isConnected ? 'disconnect' : 'connect'}
              iconPosition={isConnected ? 'end' : 'start'}
              icon={isConnected ? X : Zap}
              buttonStyle={isConnected ? 'regular' : 'action'}
              onClick={
                isConnected ? disconnectConversation : connectConversation
              }
              style={{
                fontSize: "20px", // Larger text
                padding: "16px 22px", // Larger padding
                backgroundColor: "black", // Black background
                color: "blue", // Blue text
                border: "2px solid blue", // Blue outline
                borderRadius: "8px", // Optional: rounded corners
                cursor: "pointer", // Pointer cursor for better UX
              }}
            />

          }
        </div>
      }
      {defaultView &&
        <div className="content-main">
          <div className="content-logs">
            <div className="content-block events">
              <div className="visualization">
                <div className="visualization-entry client">
                  <canvas ref={clientCanvasRef} />
                </div>
                <div className="visualization-entry server">
                  <canvas ref={serverCanvasRef} />
                </div>
              </div>
              <div className="content-block-title">events
                <span className='cost'>${usage.cost.toFixed(2)}</span>
              </div>
              <div className="content-block-title">events</div>
              <div className="content-block-body" ref={eventsScrollRef}>
                {!realtimeEvents.length && `awaiting connection...`}
                {realtimeEvents.map((realtimeEvent, i) => {
                  const count = realtimeEvent.count;
                  const event = { ...realtimeEvent.event };
                  if (event.type === 'input_audio_buffer.append') {
                    event.audio = `[trimmed: ${event.audio.length} bytes]`;
                  } else if (event.type === 'response.audio.delta') {
                    event.delta = `[trimmed: ${event.delta.length} bytes]`;
                  }
                  return (
                    <div className="event" key={event.event_id}>
                      <div className="event-timestamp">
                        {formatTime(realtimeEvent.time)}
                      </div>
                      <div className="event-details">
                        <div
                          className="event-summary"
                          onClick={() => {
                            // toggle event details
                            const id = event.event_id;
                            const expanded = { ...expandedEvents };
                            if (expanded[id]) {
                              delete expanded[id];
                            } else {
                              expanded[id] = true;
                            }
                            setExpandedEvents(expanded);
                          }}
                        >
                          <div
                            className={`event-source ${event.type === 'error'
                              ? 'error'
                              : realtimeEvent.source
                              }`}
                          >
                            {realtimeEvent.source === 'client' ? (
                              <ArrowUp />
                            ) : (
                              <ArrowDown />
                            )}
                            <span>
                              {event.type === 'error'
                                ? 'error!'
                                : realtimeEvent.source}
                            </span>
                          </div>
                          <div className="event-type">
                            {event.type}
                            {count && ` (${count})`}
                          </div>
                        </div>
                        {!!expandedEvents[event.event_id] && (
                          <div className="event-payload">
                            {JSON.stringify(event, null, 2)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="content-block conversation">
              <div className="content-block-title">conversation</div>
              <div className="content-block-body" data-conversation-content>
                {!items.length && `awaiting connection...`}
                {items.map((conversationItem, i) => {
                  return (
                    <div className="conversation-item" key={conversationItem.id}>
                      <div className={`speaker ${conversationItem.role || ''}`}>
                        <div>
                          {(
                            conversationItem.role || conversationItem.type
                          ).replaceAll('_', ' ')}
                        </div>
                        <div
                          className="close"
                          onClick={() =>
                            deleteConversationItem(conversationItem.id)
                          }
                        >
                          <X />
                        </div>
                      </div>
                      <div className={`speaker-content`}>
                        {/* tool response */}
                        {conversationItem.type === 'function_call_output' && (
                          <div>{conversationItem.formatted.output}</div>
                        )}
                        {/* tool call */}
                        {!!conversationItem.formatted.tool && (
                          <div>
                            {conversationItem.formatted.tool.name}(
                            {conversationItem.formatted.tool.arguments})
                          </div>
                        )}
                        {!conversationItem.formatted.tool &&
                          conversationItem.role === 'user' && (
                            <div>
                              {conversationItem.formatted.transcript ||
                                (conversationItem.formatted.audio?.length
                                  ? '(awaiting transcript)'
                                  : conversationItem.formatted.text ||
                                  '(item sent)')}
                            </div>
                          )}
                        {!conversationItem.formatted.tool &&
                          conversationItem.role === 'assistant' && (
                            <div>
                              {conversationItem.formatted.transcript ||
                                conversationItem.formatted.text ||
                                '(truncated)'}
                            </div>
                          )}
                        {conversationItem.formatted.file && (
                          <audio
                            src={conversationItem.formatted.file.url}
                            controls
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="content-actions">
              <Toggle
                defaultValue={false}
                labels={['manual', 'vad']}
                values={['none', 'server_vad']}
                onChange={(_, value) => changeTurnEndType(value)}
              />
              <div className="spacer" />
              {isConnected && canPushToTalk && (
                <Button
                  label={isRecording ? 'release to send' : 'push to talk'}
                  buttonStyle={isRecording ? 'alert' : 'regular'}
                  disabled={!isConnected || !canPushToTalk}
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                />
              )}
              <div className="spacer" />
              <Button
                label={isConnected ? 'disconnect' : 'connect'}
                iconPosition={isConnected ? 'end' : 'start'}
                icon={isConnected ? X : Zap}
                buttonStyle={isConnected ? 'regular' : 'action'}
                onClick={
                  isConnected ? disconnectConversation : connectConversation
                }
              />
            </div>
          </div>
          {/* <div className="content-right">
          <div className="content-block map">
            <div className="content-block-title">get_weather()</div>
            <div className="content-block-title bottom">
              {marker?.location || 'not yet retrieved'}
              {!!marker?.temperature && (
                <>
                  <br />
                  🌡️ {marker.temperature.value} {marker.temperature.units}
                </>
              )}
              {!!marker?.wind_speed && (
                <>
                  {' '}
                  🍃 {marker.wind_speed.value} {marker.wind_speed.units}
                </>
              )}
            </div>
            <div className="content-block-body full">
              {coords && (
                <Map
                  center={[coords.lat, coords.lng]}
                  location={coords.location}
                />
              )}
            </div>
          </div>
          <div className="content-block kv">
            <div className="content-block-title">set_memory()</div>
            <div className="content-block-body content-kv">
              {JSON.stringify(memoryKv, null, 2)}
            </div>
          </div>
        </div> */}
        </div>}
    </div>
  );
}
