/**
 * music21j -- Javascript reimplementation of Core music21p features.
 * music21/miditools -- A collection of tools for midi. See the namespace {@link music21.miditools}
 *
 * Copyright (c) 2014-19, Michael Scott Cuthbert and cuthbertLab
 * Based on music21 (=music21p), Copyright (c) 2006–19, Michael Scott Cuthbert and cuthbertLab
 *
 * @author Michael Scott Cuthbert
 *
 * A collection of tools for midi. See the namespace {@link music21.miditools}
 *
 * Module that holds **music21j** tools for connecting with MIDI.js and somewhat with the
 * events from the Jazz plugin or the WebMIDI protocol.
 *
 *
 * @exports music21/miditools
 * @namespace music21.miditools
 * @memberof music21
 */
import * as $ from 'jquery';
import * as MIDI from 'midicube';

import { debug } from './debug';
import '../../css/midiPlayer.css';

import * as chord from './chord';
import * as common from './common';
import * as instrument from './instrument';
import * as note from './note';

// expose midicube's MIDI to window for soundfonts to load.
window.MIDI = MIDI;

export const config = {};
/**
 * Number of octaves to transpose all incoming midi signals
 *
 * @type {number}
 * @default 0
 */
config.transposeOctave = 0;
/**
 * @class Event
 * @memberof music21.miditools
 * @param {number} t - timing information
 * @param {number} a - midi data 1 (N.B. a >> 4 = midiCommand )
 * @param {number} b - midi data 2
 * @param {number} c - midi data 3
 */
export class Event {
    constructor(t, a, b, c) {
        this.timing = t;
        this.data1 = a;
        this.data2 = b;
        this.data3 = c;
        this.midiCommand = a >> 4;  // eslint-disable-line no-bitwise
        this.noteOff = this.midiCommand === 8;
        this.noteOn = this.midiCommand === 9;

        this.midiNote = undefined;
        if (this.noteOn || this.noteOff) {
            this.midiNote = this.data2 + 12 * config.transposeOctave;
            this.velocity = this.data3;
        }
    }

    /**
     * Calls MIDI.noteOn or MIDI.noteOff for the note
     * represented by the Event (if appropriate)
     *
     * @returns {undefined}
     */
    sendToMIDIjs() {
        if (MIDI.config.is_connected) {
            // noteOn check because does not exist if no audio context
            // or soundfont has been loaded, such as if a play event
            // is triggered before soundfont has been loaded.
            if (this.noteOn) {
                MIDI.noteOn(0, this.midiNote, this.velocity, 0);
            } else if (this.noteOff) {
                MIDI.noteOff(0, this.midiNote, 0);
            }
        } else {
            console.warn('could not playback note because no MIDI connection defined');
        }
    }

    /**
     * Makes a {@link music21.note.Note} object from the event's midiNote number.
     *
     * @returns {music21.note.Note} - the {@link music21.note.Note} object represented by Event.midiNote
     */
    music21Note() {
        const m21n = new note.Note();
        m21n.pitch.ps = this.midiNote;
        return m21n;
    }
}

/**
 * How long to wait in milliseconds before deciding that a note belongs to another chord. Default 100ms
 *
 * @memberof music21.miditools.config
 * @type {number}
 */
config.maxDelay = 100; // in ms
/**
 * At what time (in ms since Epoch) the chord started.
 *
 * @memberof music21.miditools.config
 * @type {number}
 */
config.heldChordTime = 0;
/**
 * An Array (or undefined) of currently held chords that have not been sent out yet.
 *
 * @memberof music21.miditools.config
 * @type {Array|undefined}
 */
config.heldChordNotes = undefined;

/**
 * When, in MS since Jan 1, 1970, was the last {@link music21.note.Note} played.
 * Defaults to the time that the module was loaded.
 *
 * @memberof music21.miditools.config
 * @type {number}
 */
config.timeOfLastNote = Date.now(); // in ms

/**
 * The last Note or Chord to be sent out from miditools.  This is an important semi-global
 * attribute, since the last element may need to be quantized by quantizeLastNote() to
 * determine its length, since the note may need to be placed into a staff before its total
 * length can be determined.
 *
 * @memberof music21.miditools.config
 * @type {music21.chord.Chord|music21.note.Note|undefined}
 */
config.lastElement = undefined;


config._baseTempo = 60;
/**
 * Assign (or query) a Metronome object to run all timing information.
 *
 * @memberof music21.miditools.config
 * @type {music21.tempo.Metronome}
 */
config.metronome = undefined;

Object.defineProperties(config, {
    tempo: {
        enumerable: true,
        get() {
            if (this.metronome === undefined) {
                return this._baseTempo;
            } else {
                return this.metronome.tempo;
            }
        },
        set(t) {
            if (this.metronome === undefined) {
                this._baseTempo = t;
            } else {
                this.metronome.tempo = t;
            }
        },
    },
});

/**
 * a mapping of soundfont text names to true, false, or "loading".
 *
 * @memberof music21.miditools
 * @type {Object}
 */
export const loadedSoundfonts = {};



/* --------- chords ------------- */
/**
 *  Clears chords that are older than miditools.heldChordTime
 *
 *  Runs a setTimeout on itself.
 *  Calls miditools.sendOutChord
 *
 *  @memberof music21.miditools
 */
export function clearOldChords() {
    // clear out notes that may be a chord...
    const nowInMs = Date.now(); // in ms
    if (config.heldChordTime + config.maxDelay < nowInMs) {
        config.heldChordTime = nowInMs;
        if (config.heldChordNotes !== undefined) {
            // console.log('to send out chords');
            sendOutChord(config.heldChordNotes);
            config.heldChordNotes = undefined;
        }
    }
    setTimeout(clearOldChords, config.maxDelay);
}
/**
 *  Take a series of jEvent noteOn objects and convert them to a single Chord object
 *  so long as they are all sounded within miditools.maxDelay milliseconds of each other.
 *  this method stores notes in miditools.heldChordNotes (Array).
 *
 *  @param {music21.miditools.Event} jEvent
 *  @memberof music21.miditools
 *  @returns undefined
 */
export function makeChords(jEvent) {
    // jEvent is a miditools.Event object
    if (jEvent.noteOn) {
        const m21n = jEvent.music21Note();
        if (config.heldChordNotes === undefined) {
            config.heldChordNotes = [m21n];
        } else {
            for (let i = 0; i < config.heldChordNotes.length; i++) {
                const foundNote = config.heldChordNotes[i];
                if (foundNote.pitch.ps === m21n.pitch.ps) {
                    return; // no duplicates
                }
            }
            config.heldChordNotes.push(m21n);
        }
    }
}

/**
 * Take the list of Notes and makes a chord out of it, if appropriate and call
 * {@link music21.miditools.callBacks.sendOutChord} callback with the Chord or Note as a parameter.
 *
 * @memberof music21.miditools
 * @param {Array<music21.note.Note>} chordNoteList - an Array of {@link music21.note.Note} objects
 * @returns {(music21.note.Note|music21.chord.Chord|undefined)} A {@link music21.chord.Chord} object,
 * most likely, but maybe a {@link music21.note.Note} object)
 */
export function sendOutChord(chordNoteList) {
    let appendObject;
    if (chordNoteList.length > 1) {
        // console.log(chordNoteList[0].name, chordNoteList[1].name);
        appendObject = new chord.Chord(chordNoteList);
    } else if (chordNoteList.length === 1) {
        appendObject = chordNoteList[0]; // note object
    } else {
        return undefined;
    }
    appendObject.stemDirection = 'noStem';
    quantizeLastNote();
    config.lastElement = appendObject;
    if (callBacks.sendOutChord !== undefined) {
        callBacks.sendOutChord(appendObject);
    }
    return appendObject;
}

/* ----------- callbacks --------- */
// TODO: all callbacks (incl. raw, sendOutChord) should be able to be a function or an array of functions



/**
 * Quantizes the lastElement (passed in) or music21.miditools.lastElement.
 *
 * @memberof music21.miditools
 * @param {music21.note.GeneralNote} [lastElement] - A {@link music21.note.Note} to be quantized
 * @returns {music21.note.GeneralNote} The same {@link music21.note.Note} object passed in with
 * duration quantized
 */
export function quantizeLastNote(lastElement) {
    if (lastElement === undefined) {
        return undefined;
    }

    if (lastElement instanceof note.GeneralNote) {
        lastElement.stemDirection = undefined;
    }
    const nowInMS = Date.now();
    const msSinceLastNote = nowInMS - this.timeOfLastNote;
    this.timeOfLastNote = nowInMS;
    const normalQuarterNoteLength = 1000 * 60 / config.tempo;
    const numQuarterNotes = msSinceLastNote / normalQuarterNoteLength;
    let roundedQuarterLength = Math.round(4 * numQuarterNotes) / 4;
    if (roundedQuarterLength >= 4) {
        roundedQuarterLength = 4;
    } else if (roundedQuarterLength >= 3) {
        roundedQuarterLength = 3;
    } else if (roundedQuarterLength > 2) {
        roundedQuarterLength = 2;
    } else if (roundedQuarterLength === 1.25) {
        roundedQuarterLength = 1;
    } else if (roundedQuarterLength === 0.75) {
        roundedQuarterLength = 0.5;
    } else if (roundedQuarterLength === 0) {
        roundedQuarterLength = 0.125;
    }
    lastElement.duration.quarterLength = roundedQuarterLength;
    return lastElement;
}

/* ----------- callbacks --------- */
/**
 * Callback to midiEvent.sendToMIDIjs.
 *
 * @memberof music21.miditools
 * @param {music21.miditools.Event} midiEvent - event to send out.
 * @returns undefined
 */
export const sendToMIDIjs = midiEvent => {
    midiEvent.sendToMIDIjs();
};

/* ------------ MIDI.js ----------- */

/**
 * Called after a soundfont has been loaded. The callback is better to be specified elsewhere
 * rather than overriding this important method.
 *
 * @memberof music21.miditools
 * @param {string} soundfont The name of the soundfont that was just loaded
 * @param {function} callback A function to be called after the soundfont is loaded.
 */
export function postLoadCallback(soundfont, callback) {
    // this should be bound to MIDI
    if (debug) {
        console.log('soundfont loaded about to execute callback.');
        console.log(
            'first playing two notes very softly -- seems to flush the buffer.'
        );
    }
    $('.loadingSoundfont').remove();

    // noinspection JSUnresolvedVariable
    const isFirefox = typeof InstallTrigger !== 'undefined'; // Firefox 1.0+
    const isAudioTag = MIDI.config.api === 'audiotag';
    const instrumentObj = instrument.find(soundfont);
    if (instrumentObj !== undefined) {
        MIDI.programChange(
            instrumentObj.midiChannel,
            instrumentObj.midiProgram
        );
        if (debug) {
            console.log(
                soundfont + ' (' + instrumentObj.midiProgram + ') loaded on ',
                instrumentObj.midiChannel
            );
        }
        if (isFirefox === false && isAudioTag === false) {
            // Firefox ignores sound volume! so don't play!
            // as does IE and others using HTML audio tag.
            const channel = instrumentObj.midiChannel;
            MIDI.noteOn(channel, 36, 1, 0);    // if no notes have been played before then
            MIDI.noteOff(channel, 36, 1, 0.1); // the second note to be played is always
            MIDI.noteOn(channel, 48, 1, 0.2);  // very clipped (on Safari at least)
            MIDI.noteOff(channel, 48, 1, 0.3); // this helps a lot.
            MIDI.noteOn(channel, 60, 1, 0.3);  // chrome needs three notes?
            MIDI.noteOff(channel, 60, 1, 0.4);
        }
    }
    if (callback !== undefined) {
        callback(instrumentObj);
    }
    loadedSoundfonts[soundfont] = true;
}

/**
 * method to load soundfonts while waiting for other processes that need them
 * to load first.
 *
 * @memberof music21.miditools
 * @param {string} soundfont The name of the soundfont that was just loaded
 * @param {function} [callback] A function to be called after the soundfont is loaded.
 * @example
 * s = new music21.stream.Stream();
 * music21.miditools.loadSoundfont(
 *     'clarinet',
 *     function(i) {
 *         console.log('instrument object', i, 'loaded');
 *         s.instrument = i;
 * });
 */
export function loadSoundfont(soundfont, callback) {
    if (loadedSoundfonts[soundfont] === true) {
        // this soundfont has already been loaded once, so just call the callback.
        if (callback !== undefined) {
            const instrumentObj = instrument.find(soundfont);
            callback(instrumentObj);
        }
    } else if (loadedSoundfonts[soundfont] === 'loading') {
        // we are still waiting for this instrument to load, so
        // wait for it before calling callback.
        const waitThenCall = () => {
            if (loadedSoundfonts[soundfont] === true) {
                if (debug) {
                    console.log(
                        'other process has finished loading; calling callback'
                    );
                }
                if (callback !== undefined) {
                    const instrumentObj = instrument.find(soundfont);
                    callback(instrumentObj);
                }
            } else {
                if (debug) {
                    console.log('waiting for other process load');
                }
                setTimeout(waitThenCall, 100);
            }
        };
        waitThenCall();
    } else {
        // soundfont we have not seen before:
        // set its status to loading and then load it.
        loadedSoundfonts[soundfont] = 'loading';
        if (debug) {
            console.log('waiting for document ready');
        }
        $(document).ready(() => {
            if (debug) {
                console.log('document ready, waiting to load soundfont');
            }
            $(document.body).append(
                $(
                    "<div class='loadingSoundfont'><b>Loading MIDI Instrument</b>: "
                        + 'audio will begin when this message disappears.</div>'
                )
            );
            MIDI.loadPlugin({
                soundfontUrl: common.urls.soundfontUrl,
                instrument: soundfont,
                onsuccess: postLoadCallback.bind(
                    MIDI,
                    soundfont,
                    callback
                ),
            });
        });
    }
}

/**
 * MidiPlayer -- an embedded midi player including the ability to create a
 * playback device.
 *
 * @class MidiPlayer
 * @memberOf music21.miditools
 * @property {number} speed - playback speed scaling (1=default).
 * @property {jQuery|undefined} $playDiv - div holding the player,
 */
export class MidiPlayer {
    constructor() {
        this.player = new MIDI.Player();
        this.speed = 1.0;
        this.$playDiv = undefined;
    }

    /**
     * @param {jQuery|HTMLElement} [where]
     * @returns {jQuery}
     */
    addPlayer(where) {
        let $where;
        if (where === undefined) {
            where = document.body;
        }

        if (!(where instanceof $)) {
            $where = $(where);
        } else {
            $where = where;
        }

        /**
         *
         * @type {jQuery}
         */
        const $playDiv = $('<div class="midiPlayer">');
        /**
         *
         * @type {jQuery}
         */
        const $controls = $('<div class="positionControls">');
        /**
         *
         * @type {jQuery}
         */
        const $playPause = $(
            '<input type="image" alt="play" src="'
                + this.playPng()
                + '" value="play" class="playPause">'
        );

        /**
         *
         * @type {jQuery}
         */
        const $stop = $(
            '<input type="image" alt="stop" src="'
                + this.stopPng()
                + '" value="stop" class="stopButton">'
        );

        $playPause.on('click', () => this.pausePlayStop());
        $stop.on('click', () => this.stopButton());
        $controls.append($playPause);
        $controls.append($stop);
        $playDiv.append($controls);

        /**
         *
         * @type {jQuery}
         */
        const $time = $('<div class="timeControls">');
        /**
         *
         * @type {jQuery}
         */
        const $timePlayed = $('<span class="timePlayed">0:00</span>');
        /**
         *
         * @type {jQuery}
         */
        const $capsule = $(
            '<span class="capsule"><span class="cursor"></span></span>'
        );
        /**
         *
         * @type {jQuery}
         */
        const $timeRemaining = $('<span class="timeRemaining">-0:00</span>');
        $time.append($timePlayed);
        $time.append($capsule);
        $time.append($timeRemaining);
        $playDiv.append($time);

        $where.append($playDiv);
        this.$playDiv = $playDiv;
        return $playDiv;
    }

    stopButton() {
        this.pausePlayStop('yes');
    }

    /**
     *
     * @returns {string}
     */
    playPng() {
        return common.urls.midiPlayer + '/play.png';
    }

    /**
     *
     * @returns {string}
     */
    pausePng() {
        return common.urls.midiPlayer + '/pause.png';
    }

    /**
     *
     * @returns {string}
     */
    stopPng() {
        return common.urls.midiPlayer + '/stop.png';
    }

    pausePlayStop(stop) {
        let d;
        if (this.$playDiv === undefined) {
            d = { src: 'doesnt matter' };
        } else {
            d = this.$playDiv.find('.playPause')[0];
        }
        if (stop === 'yes') {
            this.player.stop();
            d.src = this.playPng();
        } else if (this.player.playing || stop === 'pause') {
            d.src = this.playPng();
            this.player.pause(true);
        } else {
            d.src = this.pausePng();
            this.player.resume();
        }
    }

    base64Load(b64data) {
        const player = this.player;
        player.timeWarp = this.speed;

        const m21MidiPlayer = this;
        loadSoundfont('acoustic_grand_piano', () => {
            player.loadFile(
                b64data,
                () => {
                    // success
                    m21MidiPlayer.fileLoaded();
                },
                undefined, // loading
                e => {
                    // failure
                    console.log(e);
                }
            );
        });
    }

    songFinished() {
        this.pausePlayStop('yes');
    }

    fileLoaded() {
        this.updatePlaying();
    }

    startAndUpdate() {
        this.player.start();
        this.updatePlaying();
    }

    updatePlaying() {
        const self = this;
        const player = this.player;
        if (this.$playDiv === undefined) {
            return;
        }
        const $d = this.$playDiv;
        // update the timestamp
        const timePlayed = $d.find('.timePlayed')[0];
        const timeRemaining = $d.find('.timeRemaining')[0];
        const timeCursor = $d.find('.cursor')[0];
        const $capsule = $d.find('.capsule');
        //
        $capsule.on('dragstart', e => {
            player.currentTime = (e.pageX - $capsule.left) / 420 * player.endTime;
            if (player.currentTime < 0) {
                player.currentTime = 0;
            }
            if (player.currentTime > player.endTime) {
                player.currentTime = player.endTime;
            }
            if (self.state === 'down') {
                this.pausePlayStop('pause');
            } else if (self.state === 'up') {
                this.pausePlayStop('play');
            }
        });
        //
        const timeFormatting = n => {
            const minutes = Math.floor(n / 60);
            let seconds = String(Math.floor(n - minutes * 60));
            if (seconds.length === 1) {
                seconds = '0' + seconds;
            }
            return minutes + ':' + seconds;
        };

        player.setAnimation(data => {
            const percent = data.now / data.end;
            const now = Math.floor(data.now); // where we are now
            const end = Math.floor(data.end); // end of song
            if (now === end) {
                // go to next song
                self.songFinished();
            }
            // display the information to the user
            timeCursor.style.width = percent * 100 + '%';
            timePlayed.innerHTML = timeFormatting(now);
            timeRemaining.innerHTML = '-' + timeFormatting(end - now);
        });
    }
}

/**
 * callBacks is an object with three keys:
 *
 * - raw: function (t, a, b,c) to call when any midi event arrives.
 *     Default: `function (t, a, b, c) { return new miditools.Event(t, a, b, c); }`
 * - general: function ( miditools.Event() ) to call when an Event object
 *     has been created. Default:
 *     `[miditools.sendToMIDIjs, miditools.quantizeLastNote]`
 * - sendOutChord: function (note.Note[]) to call
 *     when a sufficient time has passed to build a chord from input.
 *     Default: empty function.
 *
 * At present, only "general" can take an Array of event listening functions,
 * but I hope to change that for sendOutChord also.
 *
 * "general" is usually the callback list to play around with.
 *
 * @memberof music21.miditools
 */
export const callBacks = {
    raw: (t, a, b, c) => new Event(t, a, b, c),
    general: [sendToMIDIjs, quantizeLastNote],
    sendOutChord: arrayOfNotes => {},
};
