var https = require('https');
var fs = require('fs');
var util = require('util');

var path = require('path');
var xml2js = require('xml2js');
var querystring = require('querystring');
var crypto = require('crypto');
var dateFormat = require('dateformat');
var Bot = require('ttapi');
var sprintf = require('sprintf').sprintf;
var myhttp = require('http-get');
var $ = require('jquery');
var twitter = require('ntwitter');
var Lastfm = require('simple-lastfm');

var User = require('./TTUser.js');
var Queue = require('./ttqueue.js');

process.on('uncaughtException', function(err) {
	log("uncaughtException: ", err);
	log("stack trace: ", err.stack);
});

var avatars = {
		'chinesegirl': 1,
		'greengirl': 2,
		'redheadgirl': 3,
		'gingergirl': 4,
		'whiteboy': 5,
		'tangirl': 6,
		'tanboy': 7,
		'gingerboy': 8,
		'blackboy': 34,
		'greenbear': 9,
		'greybear': 10,
		'greenbear': 11,
		'alienbear': 12,
		'aquabear': 13,
		'maroonbear': 14,
		'orangebear': 15,
		'blackbear': 16,
		'bluebear': 17,
		'lightbluecat': 18,
		'greencat': 19,
		'redcat': 121,
		'blondesuperboy': 20,
		'redheadsuperboy': 21,
		'hornedsuperboy': 22,
		'gorilla': 23,
		'boymonkey': 36,
		'girlmonkey': 37,
		'spaceman1': 27,
		'spaceman2': 28,
		'spaceman3': 29,
		'spaceman4': 30,
		'spaceman5': 31,
		'spaceman6': 32,
		'spaceman7': 33,
		'daftpunk1': 26,
		'daftpunk2': 35
};
var avatar_options = [];
for(var avatar in avatars)
	avatar_options.push(avatar);

var cmbot = function(_options) {
	var cmbot = this;
	this.VERSION = '0.9.0';
	
	this.initOptions(_options);
	this.currentSong = false;
	
	this.timezones =  {
		'EST': '-5',
		'CST': '-6',
		'MST': '-7',
		'PST': '-8',
	};
	this.bot = new Bot(this.options.bot.auth, this.options.bot.userid, this.options.bot.roomid);
	
	this.customEvents = {};
	this.customCommands = {};
	
//	this.setStrings();
	this.session = {
		lamed: false, // Has the bot lamed the currently playing track?
		scrobbled: false,
		current_scrobble: false, // timer for the current scrobble - if the user steps down or is taken down before the scrobble happens, cancel the timer to do the scrobble
		djs: [],
		djing: false, // is the bot dj'ing
		loved: false,
		autodjing: false, // If the bot autodj's, this will get set to true. When someone adds themselves to the queue, the bot will only step down if it automatically stepped up (ie, it won't step down if a mod made it dj manually)
		autodj: this.options.autodj,
		snagged: false,
		stfu: false,
		max_djs: 5,
		current_dj: false, // Which dj is currently playing a song
		songstarted: false, // timestamp of when the current song started
		refreshes: [], // DJ's who are refreshing their browser
		warned: false,
		triggers: {},
		timers: {
			autodj: false
		},
		current_song_tags: false,
		votes: {
			up: [],
			down: []
		},
		enforcement: true, // Queue enforcement
		queueTimer: {},
		lastfm: {
			enabled: false
		},
		start_time: new Date()
	};

	
	if(this.options.messages.length > 0)
		this.setupMessages(); // Start the timers to display informational messages
	this.settings = $.extend({
		shitlist: {},
		idleDJTimeout: 15,
		triggerLimit: {},
		triggerBan: {},
		timezones: {},
		triggers: {},
		playcounts: {},
		bannedTracks: {},
		room_name: false,
		room_shortcut: false,
		room_id: false,
		queue: [],
		phrases: {},
		bannedArtists: {},
		acl: {
			addacl: {},
			remacl: {}
		},
		lastfm_session_key: false
		}, this.loadSettings());

	this.initQueue();
	
	this.lastfm = false;
	if(this.options.lastfm.enabled === true) {
		if(this.settings.lastfm_session_key != undefined && this.settings.lastfm_session_key != '')
			this.options.lastfm.session_key = this.settings.lastfm_session_key;
		this.lastfm = new Lastfm(this.options.lastfm);
		if(this.options.lastfm.session_key === false) {
			this.lastfm.getSessionKey(function(result) {
				log("session key = " + result.session_key);
				cmbot.settings.lastfm_session_key = result.session_key;
				cmbot.saveSettings();
			});
		}
	}

	this.users = {};
	this.mods = {};
	
	this.commandAliases = {
		'commands': 'help',
		'unafk': 'back',
		'away': 'afk'
	};

	// Command Time Limits - how many seconds since the last time this command was said by any user before the bot will respond to it again
	this.commandTimeLimits = {
		triggers: 5,
		queue: 5,
		help: 5
	};

	this.commandTimestamps = {};
	this.triggerTimeStamps = {};

	this.twit = false;
	if(typeof this.options.twitter == 'object') {
		try {
			this.twit = new twitter({
				consumer_key: this.options.twitter.consumer_key,
				consumer_secret: this.options.twitter.consumer_secret,
				access_token_key: this.options.twitter.access_token_key,
				access_token_secret: this.options.twitter.access_token_secret
			});
			this.twit.verifyCredentials(function (err, data) {
				log("twitter verified");
//	        log(data);
			});
		} catch(e) {}
	}
	
	

	this.eventReady();
	
	this.eventRoomChanged();
	this.eventSpeak();
	this.eventPM();
	
	this.eventUpdateVotes();
	this.eventNewSong();
	this.eventEndSong();
	this.eventAddDj();
	this.eventRemDj();
	this.eventUpdateUser();
	this.eventNewModerator();
	this.eventRemModerator();
	this.eventRegistered();
	this.eventDeregistered();
	
	this.eventTcpConnect();
	this.eventTcpMessage();
	this.eventTcpEnd();
	this.eventHttpRequest();
	
	if(this.options.mysql.enabled) {
		var song_table = 'song';
		var songlog_table = 'songlog';
		var mysql = this.getMysqlClient();
		log("Checking for table '" + song_table + "':");
		mysql.query("show tables like '" + song_table + "'", 
			function selectCb(err, results, fields) {
			if(results.length == 0) {
				mysql.query(
						'CREATE TABLE IF NOT EXISTS `' + song_table + '` (' + 
						'`id` varchar(100) NOT NULL,' + 
						'`track` varchar(255) DEFAULT NULL,' + 
						'`artist` varchar(255) DEFAULT NULL,' + 
						'`album` varchar(255) DEFAULT NULL,' + 
						'`coverart` varchar(255) DEFAULT NULL,' + 
						'`length` int(11) DEFAULT NULL,' + 
						'`mnid` varchar(50) DEFAULT NULL,' + 
						'`genre` varchar(255) DEFAULT NULL,' + 
						'PRIMARY KEY (`id`)' + 
						') ENGINE=InnoDB DEFAULT CHARSET=utf8;', function(err) {
							log("Checking for table '" + songlog_table + "'");
							mysql.query("show tables like '" + songlog_table + "'", 
									function selectCb(err, results, fields) {
										if(results.length == 0) {
											mysql.query(
													'CREATE TABLE IF NOT EXISTS `' + songlog_table + '` (' + 
													'`songid` varchar(100) DEFAULT NULL,' + 
													'`starttime` datetime NOT NULL,' + 
													'`upvotes` int(11) DEFAULT NULL,' + 
													'`downvotes` int(11) DEFAULT NULL,' + 
													'PRIMARY KEY (`starttime`),' + 
													'KEY `songid` (`songid`)' + 
													') ENGINE=InnoDB DEFAULT CHARSET=utf8;', function(err) {
														mysql.query(
															'ALTER TABLE `' + songlog_table + '`' + 
															'ADD CONSTRAINT `' + songlog_table + '_ibfk_1` FOREIGN KEY (`songid`) REFERENCES `' + song_table + '` (`id`);', function(err) {
																log("Done!");
															});
													});
										}
							});
						});
			}
		});
		
		
	}
};

cmbot.prototype.addCommand = function(commandName, obj) {
	if(this.commands[commandName] == undefined) {
		this.customCommands[commandName] = obj;
		log("Command " + commandName + " added");
	} else {
		log("Command " + commandName + "not added as there already exists a command by that name.");
	}
};

cmbot.prototype.eventReady = function() {
	var cmbot = this;
	this.bot.on('ready', function () {
		cmbot.bot.roomRegister(cmbot.options.bot.roomid);
		if(typeof cmbot.customEvents['ready'] == 'function') {
			cmbot.customEvents['ready'](data);
		}
	});
};

cmbot.prototype.eventRoomChanged = function() {
	var cmbot = this;
	this.bot.on('roomChanged',  function (data) {
//		log("room changed: ", data);
//		log("djs:", data.room.metadata.js);
//		log("data: ", data.room.metadata.current_song);
		cmbot.currentSong = data;
		cmbot.session.djs = data.room.metadata.djs;
		cmbot.session.max_djs = data.room.metadata.max_djs;
		
		if(cmbot.settings.room_name === false || cmbot.settings.room_id === false) {
			cmbot.settings.room_name = data.room.name;
			if(data.room.shortcut != '')
				cmbot.settings.room_shortcut = data.room.shortcut;
			cmbot.settings.room_id = data.room.roomid;
			cmbot.saveSettings();
		}
		
		$.each(data.room.metadata.votelog, function(index, vote) {
			var userid = vote[0];
			var upordown = vote[1];
			if(cmbot.session.votes['up'].indexOf(userid) > -1)
				cmbot.session.votes['up'].splice(cmbot.session.votes['up'].indexOf(userid), 1);
			if(cmbot.session.votes['down'].indexOf(userid) > -1)
				cmbot.session.votes['down'].splice(cmbot.session.votes['down'].indexOf(userid), 1);
			if(cmbot.session.votes[upordown] == undefined)
				cmbot.session.votes[upordown] = [];
			cmbot.session.votes[upordown].push(userid);
		});

		
		
		// If the current song hasn't been scrobbled yet, scrobble it
//		var timeCode =  (currentSong.room.metadata.current_song.starttime * 1000) - now();
//		log("song has been playing for " + timeCode + " seconds");
		//1328209511314 (now)
		//1328222953.3 (starttime)
		if(data.room.metadata.upvotes > 10)
			cmbot.session.loved = true;
		
//		log("users: ", data.users);
		
		$(data.room.metadata.moderator_id).each(function(index, value) {
			cmbot.mods[value] = 1;
		});
		try {
			
			//fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings));
		} catch(e) {
			
		}

		
		$(data.users).each(function(index, user) {
			if (typeof cmbot.users[user.userid] != 'object') {
				if(user.acl > 0)
					cmbot.mods[user.userid] = 1;
				cmbot.users[user.userid] = new User({userid: user.userid, name: user.name, mod: cmbot.mods[user.userid] == 1 || user.acl > 0});
			}
		});
		$.each(cmbot.q.getQueue(), function(index, userid) {
			if(cmbot.users[userid] == undefined) {
				log("removing user " + userid + " from queue.");
				cmbot.q.removeUser({userid: userid});
			}
		});
		
		$(cmbot.session.djs).each(function(index, userid) {
			cmbot.users[userid].djing = true;
			cmbot.activateIdleDJCheck(cmbot.users[userid]);
		});
		cmbot.loadPlayCounts();
		cmbot.autodj();
		if(typeof cmbot.customEvents['roomChanged'] == 'function' && data.userid != cmbot.options.bot.userid) {
			cmbot.customEvents['roomChanged'](data);
		}
	});
};

cmbot.prototype.eventSpeak = function() {
	var cmbot = this;
	this.bot.on('speak', function (data) {
//		log("received speak: ", data);
		var user = cmbot.users[data.userid];
		if(typeof user == 'object') {
//			log("setting last interaction for user to now: ", users[data.userid]);
			user.lastInteraction = now();
			if(user.djing)
				cmbot.activateIdleDJCheck(user);
			clearTimeout(user.timers.idleDJRemove);
			user.timers.idleDJRemove = false;
			clearTimeout(user.timers.idleDJEscort);
			user.idleDJEscort = false;
		}
		data.origin = 'chat';
		if (data.text.match(/^\//) && data.userid != cmbot.options.bot.userid) 
			cmbot.reactToCommand(data);
		else 
			if (data.userid != cmbot.options.bot.userid) { // Don't react to what the bot says
//				cmbot.monitorAfk(data);
				cmbot.reactToSpeak(data);
			}
		if(typeof cmbot.customEvents['speak'] == 'function' && data.userid != cmbot.options.bot.userid) {
			cmbot.customEvents['speak'](data);
		}
	});
};

cmbot.prototype.eventPM = function() {
	var cmbot = this;
	this.bot.on('pmmed', function(data) {
		if(cmbot.users[data.senderid] == undefined)
			return false;
		var userid = data.senderid;
		if(cmbot == undefined || cmbot.users == undefined)
			return false;
		if(!cmbot.users[userid].present)
			return false;
		var command = arg = '';
		if(data.text.match(/^\/([^ ]+)\s{0,1}(.*)$/)) {
			command = RegExp.$1;
			arg = RegExp.$2;
		}
		command = command.toLowerCase();
		
		log("received a PM from: " + cmbot.users[userid].name + ": " + data.text);

		if(cmbot.commandAliases[command] != undefined)
			command = cmbot.commandAliases[command];
		
		var theCommand = false;
		if(typeof cmbot.commands[command] == 'object') {
			theCommand = cmbot.commands[command];
		} else if(typeof cmbot.customCommands[command] == 'object') {
			theCommand = cmbot.customCommands[command];
		}
		
		if(theCommand !== false) {
		
//		if(typeof cmbot.commands[command] == 'object') {
			log("found a command: " + command);
			if(typeof theCommand.command == 'function') {//} && theCommand.pmonly) {
//				log("command: ", theCommand);
//				log("user: ", cmbot.users[userid]);
				if(!theCommand.modonly || cmbot.users[userid].mod) {
					var go = true;
					if(theCommand.acl === true)
						go = false; // Enforce ACL restrictions
					if(cmbot.settings.acl[command] != undefined) {
						go = false;
						if(cmbot.settings.acl[command][userid])
							go = true;
					}
					if(userid == cmbot.options.master_userid)
						go = true;
					if(go)
						theCommand.command({
								cmbot: cmbot,
								pm: true, 
								userid: userid,
								arg: arg
							});
					else
						cmbot.bot.pm("You don't have permission to run that command.", userid);
				}
			}
		} else if (cmbot.settings.triggers[escape(command)] != undefined) {
			cmbot.doTrigger(userid, command);
		} else if(command == '') {
			if(cmbot.users[userid].mod) {
				log("Sending this to all mods: " + data.text);
				cmbot.modpm(data.text, false, userid);
			} else {
				cmbot.bot.pm("Sorry, but I'm not a real person. Please PM a mod for help, or, for a list of commands I respond to, PM me '/help'.", userid);
			}
		}
		if(typeof cmbot.customEvents['pmmed'] == 'function') {
			cmbot.customEvents['pmmed'](data);
		}
	});
};

cmbot.prototype.eventUpdateVotes = function() {
	var cmbot = this;
	this.bot.on('update_votes', function (data) {
//		log("Someone voted: ", data);
//		log("votelog: ", data.room.metadata.votelog);
		$.each(data.room.metadata.votelog, function(index, vote) {
			var userid = vote[0];
			var upordown = vote[1];
			if(userid != '') {
				if(cmbot.session.votes['up'].indexOf(userid) > -1)
					cmbot.session.votes['up'].splice(cmbot.session.votes['up'].indexOf(userid), 1);
				if(cmbot.session.votes['down'].indexOf(userid) > -1)
					cmbot.session.votes['down'].splice(cmbot.session.votes['down'].indexOf(userid), 1);
				if(cmbot.session.votes[upordown] == undefined)
					cmbot.session.votes[upordown] = [];
				cmbot.session.votes[upordown].push(userid);
			}
		});
		
		
		
		var userid = 0;
		$(data.room.metadata.votelog[0]).each(function(index, prop) {
			userid = prop;
			return false;
		});
		if (typeof cmbot.users[userid] == 'object') {
			cmbot.users[userid].lastInteraction = now();
			try {
				clearTimeout(cmbot.users[userid].timers.idleDJRemove);
				cmbot.users[userid].idleDJRemove = false;
				clearTimeout(cmbot.users[userid].timers.idleDJEscort);
				cmbot.users[userid].idleDJEscort = false;
				if(cmbot.users[userid].djing)
					cmbot.activateIdleDJCheck(cmbot.users[userid]);
			} catch(e) {
				log("Exception clearing timeout: ", e);
			}
		}
		// If 5 users or over 20% of the population in the room (whichever is lower) have upvoted, then up vote
		var numUsers = 0;
		$.each(cmbot.users, function(userid, user) {
			if(user.present)
				numUsers++;
		});
		var num = 5;
		if((numUsers * .2) < 5)
			num = Math.floor(numUsers * .2);
//		log("With " + numUsers + " users, num = " + num);
		if (userid != cmbot.options.bot.userid) {
			if (data.room.metadata.upvotes >= num && !cmbot.session.lamed) 
				cmbot.bot.vote('up');
			if (data.room.metadata.upvotes > cmbot.options.snag_threshold && !cmbot.session.loved) {
				log("Yoinking track");
				cmbot.yoinkTrack();
				cmbot.bot.snag();
				cmbot.session.loved;
			}
		}
		if(typeof cmbot.customEvents['update_votes'] == 'function') {
			cmbot.customEvents['update_votes'](data);
		}
	});
};

cmbot.prototype.eventNewSong = function() {
	var cmbot = this;
	this.bot.on('newsong', function(data) {
		cmbot.session.lamed = false;
		cmbot.session.loved = false;
		cmbot.session.warned = false;
		cmbot.session.current_song_tags = false;
		cmbot.session.snagged = false;
		cmbot.session.votes = {
			up: [],
			down: []
		};
//		setTimeout(function() {
//			bot.vote('up');
//		}, 4000);
//		log("song started: %o", data);
//		log("djs: %o", data.room.metadata.djs);
//		usersOnDecks = data.room.metadata.djs;
		cmbot.currentSong = data;
		var song = data.room.metadata.current_song;
		log("New song playing: " + song.metadata.song + " by " + song.metadata.artist + " dj'd by " + song.djname);
		var artist = song.metadata.artist;
		var banned = false;
		for(var bannedArtist in cmbot.settings.bannedArtists) {
			var checkArtist = bannedArtist.toLowerCase();
			if(checkArtist == artist.toLowerCase()) {
				cmbot.bot.speak(song.djname + ", " + artist + " is banned!");
				cmbot.bot.remDj(song.djid);
				banned = true;
			}
		}
		if(banned) {
			return false;
		}
		cmbot.session.current_dj = song.djid;
		
		if(cmbot.options.scrobble === true && cmbot.lastfm !== false) {
			// Set a timer to scrobble this play
			var length = song.metadata.length;
			if (length > 30) { // Don't scrobble tracks under 30 seconds
				
				cmbot.lastfm.scrobbleNowPlayingTrack({
					artist: song.metadata.artist,
					track: song.metadata.song,
					callback: function(result) {
						log(result.success ? "Track scrobbled (now playing)." : "Error scrobbling (now playing) track: " + result.error);
					}
				});
				var scrobbleAt = length / 2 < 60 * 4 ? length / 2 : 60 * 4;
				var scrobbleTime = Math.floor(now() / 1000);
//				log("scrobble at: " + scrobbleAt);
				cmbot.session.current_scrobble = setTimeout(function() {
					cmbot.session.current_scrobble = false;
					cmbot.lastfm.scrobbleTrack({
						artist: song.metadata.artist,
						track: song.metadata.song,
						timestamp: scrobbleTime,
						callback: function(result) {
							log(result.success ? song.metadata.song + " by " + song.metadata.artist + " scrobbled." : "Error scrobbling track: " + result.error);
							cmbot.session.scrobbled = true;
	//						log("Scrobbled: ", result);
						}
					});
				}, scrobbleAt*1000);
			}
		}
		// Tweet
		if(cmbot.twit !== false && cmbot.options.twitter.tweet_text != '') {
			var text = cmbot.options.twitter.tweet_text;
			text = text.replace('%djname%', cmbot.users[song.djid].name);
			text = text.replace('%song%', song.metadata.song);
			text = text.replace('%artist%', song.metadata.artist);
			text = text.replace('%roomname%', cmbot.settings.room_name);
			text = text.replace('%roomurl%', 'http://turntable.fm/' + cmbot.settings.room_shortcut);
			cmbot.twit.updateStatus(text,
				function (err, data) {
					log("tweeted");
				}
			);
		}
		cmbot.session.scrobbled = false;
		if(typeof cmbot.customEvents['newsong'] == 'function') {
			cmbot.customEvents['newsong'](data);
		}
	});
};

cmbot.prototype.eventEndSong = function() {
	var cmbot = this;
	this.bot.on('endsong', function(data) {
//		log("song ended: ", data);
		var songstarted = cmbot.session.songstarted;
		cmbot.session.songstarted = now();

		try {
			if (cmbot.currentSong !== false) {
				if(data.room.metadata.current_dj == cmbot.options.bot.userid) {
					try {
						cmbot.bot.playlistAll('default', function(res) {
							log("length: " + $(res.list).length);
							var plLength = $(res.list).length;
							// First song
							var r = getRandomNumber(20, plLength);
							var song = res.list[r];
							log("Putting " + song.metadata.song + " by " + song.metadata.artist + " at the top of my queue.");
							cmbot.bot.playlistReorder('default', r, 0, function(result) {
								if(result.success) {
									log("Random song chosen.");
								}
							});
						});
					} catch(e) {
						log("Exception trying to put a random song at the top of the bot's queue: ", e);
					}
					
					if(cmbot.q.getQueueLength(true) > 0) {
						cmbot.bot.remDj(cmbot.options.bot.userid, function(result) {
							cmbot.users[cmbot.options.bot.userid].djing = false;
							cmbot.session.djing = false;
						});
					}
				}
				if(cmbot.session.current_scrobble !== false) {
					clearTimeout(cmbot.session.current_scrobble);
				}
				if(cmbot.options.mysql.enabled) {
					var mysql = cmbot.getMysqlClient();
					var song = cmbot.currentSong.room.metadata.current_song;
					mysql.query("SELECT id FROM song WHERE id = '" + cmbot.currentSong.room.metadata.current_song._id + "'", 
						function selectCb(err, results, fields) {
							log("results: ", results);
							if(err) {
								log("MYSQL ERROR LOOKING FOR SONG! ", err);
							}
							if(results.length == 0) {
								// Save this song
								mysql.query("INSERT INTO song VALUES(?, ?, ?, ?, ?, ?, ?, ?)", 
								[
								 	song._id,
								 	song.metadata.song.replace('/\\/', ''),
								 	song.metadata.artist.replace('/\\/', ''),
								 	song.metadata.album.replace('/\\/', ''),
								 	song.metadata.coverart,
								 	song.metadata.length,
								 	song.metadata.mnid,
								 	song.metadata.genre != undefined ? song.metadata.genre.replace('/\\/', '') : ''
								]
								);
							}
							// Now save the play
							var insert_array = [
												 song._id,
												 songstarted !== false ? songstarted / 1000 : (now() / 1000) - data.room.metadata.current_song.metadata.length,
												 parseInt(data.room.metadata.upvotes),
												 parseInt(data.room.metadata.downvotes)
												];
							log("insert array: ", insert_array);
							mysql.query("INSERT INTO songlog VALUES (?, DATE_FORMAT(FROM_UNIXTIME(?), '%Y-%m-%d %k:%i:%s'), ?, ?)",
								insert_array
							);
							mysql.end();
						}
					);
				}
				
				if(cmbot.options.scrobble === true && cmbot.lastfm !== false) {
					var length = cmbot.currentSong.room.metadata.current_song.metadata.length;
					var scrobbleAt = length / 2 < 60 * 4 ? length / 2 : 60 * 4;
//					log("scrobbled: " + cmbot.session.scrobbled);
//					log("length: " + length);
					if(!cmbot.session.scrobbled && length > 30) { // This track hasn't been scrobbled yet
						var scrobbleTime = Math.floor((now() / 1000) - length);
//						log("now = " + now());
//						log("length = " + length);
//						log("(now() / 1000) - scrobbleAt = "  + ((now() / 1000) - scrobbleAt));
//						log("session.start_time.getTime() / 1000 = " + (cmbot.session.start_time.getTime() / 1000));
						
						if((now() / 1000) - scrobbleAt > cmbot.session.start_time.getTime() / 1000) { // If the bot started up before the middle of this song elapsed, scrobble it
							log("Scrobbling track!"); 
							cmbot.lastfm.scrobbleTrack({
								artist: cmbot.currentSong.room.metadata.current_song.metadata.artist,
								track: cmbot.currentSong.room.metadata.current_song.metadata.song,
								timestamp: scrobbleTime,
								callback: function(result) {
									log(result.success ? "Track scrobbled. (" + cmbot.currentSong.room.metadata.current_song.metadata.artist + " - " + cmbot.currentSong.room.metadata.current_song.metadata.song + ") " : "Error scrobbling track: " + result.error);
									cmbot.session.scrobbled = true;
								}
							});
						}
					}
				}
				var userid = cmbot.currentSong.room.metadata.current_dj;
				var user = cmbot.users[userid];
				clearTimeout(user.timers.warning);
				user.playcount++;
				cmbot.savePlayCounts();
				if (((user.playcount == cmbot.options.set_limit && cmbot.session.enforcement) || user.escortme)) {
					user.escortme = false;
					log(user.name + " has hit song limit of " + cmbot.options.set_limit + ", removing from the decks.");
					cmbot.bot.remDj(user.userid);
				} else if(user.idleDJEscort) {
					user.idleDJEscort = false;
					cmbot.bot.remDj(user.userid);
				}
			}
		} 
		catch (e) {
			log("EXCEPTION! ", e);
		}
		if(typeof cmbot.customEvents['endsong'] == 'function') {
			cmbot.customEvents['endsong'](data);
		}
	});
};

cmbot.prototype.eventAddDj = function() {
	var cmbot = this;
	this.bot.on('add_dj', function(data) {
		var newDj = cmbot.users[data.user[0].userid];
		if(newDj.userid == cmbot.options.bot.userid) {
			cmbot.session.djing = true;
			cmbot.bot.playlistAll('default', function(res) {
				try {
		//			cmbot.randomizePlaylist(function(success) {
		//				if (success) {
		//					log("Playlist randomized");
		//				}
		//			});
					log("length: " + $(res.list).length);
					var plLength = $(res.list).length;
					// First song
					var r = getRandomNumber(20, plLength);
					var song = res.list[r];
					log("Putting " + song.metadata.song + " by " + song.metadata.artist + " at the top of my queue.");
					cmbot.bot.playlistReorder('default', r, 0, function(result) {
						if(result.success) {
							log("Random song chosen.");
						} else {
							log("Failed to reorder playlist: ", result);
						}
					});
				} catch(e) {}
				});
		}
		
		
		newDj.lastInteraction = now();
		newDj.escorted = false;
		cmbot.activateIdleDJCheck(newDj);
		if (!cmbot.isFFA()) {
			// If there's a queue, make sure the person who steps up is the first non-afk person in the queue
			var foundUser = false;
			if (!newDj.refresh) {
				var numDjs = cmbot.session.djs.length + 1; // Need to add one because we haven't pushed this dj onto the array yet
				var freeSpots = cmbot.session.max_djs - numDjs;
				var queueLength = cmbot.q.getQueueLength();
				var queueSpot = -1;
				if(cmbot.session.refreshes.length <= freeSpots && cmbot.session.refreshes.indexOf(newDj.userid) == -1 && cmbot.session.enforcement && queueSpot > -1) {
					log("There's a user refreshing but someone else stepped up.");
				} else if (queueLength > 0 && freeSpots <= queueLength && cmbot.session.refreshes.indexOf(newDj.userid) == -1) {
					var idx = 0;
					$(cmbot.q.getQueue()).each(function(index, userid){
						if(userid == newDj.userid)
							queueSpot = idx;
						if(typeof cmbot.users[userid] == 'object')
							if(!cmbot.users[userid].afk)
								idx++;
						
					});
					log("queueSpot = " + queueSpot);
					log("freespots = " + freeSpots);
					if(queueSpot == -1) {
						log("User is not in queue");
					}
					if(queueSpot > 0 && queueSpot >= freeSpots) {
						log("queuespot is greater than free spots & > 0");
					}
				}
				
				if (queueLength > 0 && freeSpots <= queueLength) {
					$(cmbot.q.getQueue()).each(function(index, userid){
						var user = cmbot.users[userid];
						try {
							if (!user.afk && user.present) {
								log("found non afk user: " + user.name);
								try {
									if (user.userid != newDj.userid && !foundUser && cmbot.session.enforcement) {
										// Look at past escorts, and if there are 3 in the last 10 seconds, kick the user
										if (newDj.escorts == undefined) 
											newDj.escorts = [];
										newDj.escorts.push(now());
										var numEscorts = 0;
										$(newDj.escorts).each(function(index, escortTimestamp){
											if (((now() - escortTimestamp) / 1000) < 10) {
												numEscorts++;
											}
										});
										log("numEscorts: " + numEscorts);
										if (numEscorts >= 3) {
											cmbot.bot.bootUser(newDj.userid, "We have a queue here, please check your message window.");
//											bot.pm("http://goo.gl/krnve", newDj.userid);
											cmbot.bot.speak("Hasta la vista, meatbag! http://goo.gl/krnve");
										}
										else {
											if(numEscorts <= 1)
												cmbot.bot.pm(":warning:" + user.name + " is next in the queue. Type /addme to add yourself. :warning:", newDj.userid, function(result) {
													if(!result.success && result.errid == 5) {
														cmbot.bot.speak(":warning: " + newDj.name + ", " + user.name + " is next in the queue. Type /addme to add yourself. :warning:", newDj.userid);
													}
												}); //cmbot.bot.speak("@" + newDj.name + ", " + user.name + " is next in the queue. Type /addme to add yourself.");
											cmbot.bot.remDj(newDj.userid);
											newDj.escorted = true;
											newDj.djing = false;
										}
									}
								} 
								catch (e) {
									log("Exception checking users: ", e);
								}
								foundUser = true;
								return false;
							} else if(userid == data.userid) {
								// The user who stepped up is afk, and is currently in the queue, before any non-afk users, so remove them from the queue.
								foundUser = true;
								return false;
							}
						} 
						catch (e) {
						}
					});
				}
				
				if (foundUser && !newDj.escorted) {
					log("removing " + data.user[0].name + " from queue because they just stepped up.");
					//		usersOnDecks.push(newDj.userid);
					cmbot.q.removeUser(newDj);
				}
			}
		} else { //ffa
			/*
			var numFreeSpots = 5 - session.djs.length;
			if(session.refreshes.length > 0 && session.refreshes.length <= numFreeSpots && session.refreshes.indexOf(newDj.userid) == -1 && enforcement) {
				// At least one dj is in the middle of a refresh, and someone else tried to step up yet there arent' enough spots, so escort them
				bot.remDj(newDj.userid);
				newDj.escorts.push(now());
				var numEscorts = 0;
				$(newDj.escorts).each(function(index, escortTimestamp){
					if (((now() - escortTimestamp) / 1000) < 10) {
						numEscorts++;
					}
				});
				log("numEscorts: " + numEscorts);
				if (numEscorts >= 3) {
					bot.bootUser(newDj.userid, "Pay attention.");
					cmbot.bot.speak("Hasta la vista, meatbag!");
				}
				if(numEscorts == 1)
					bot.pm("Sorry, but at least one DJ is currently refreshing their browser. Please wait until another spot opens up.", newDj.userid);
			}
			*/
		}
		if(newDj.refresh) {
			cmbot.session.refreshes.splice(cmbot.session.refreshes.indexOf(newDj.userid));
			clearTimeout(newDj.timers.removeRefresh);
			newDj.timers.removeRefresh = false;
		}
		// If the new dj message isnt set up, dont bother checking the dj's file
		if(cmbot.options.new_dj_message !== false && cmbot.options.new_dj_message != '') {
			if(!cmbot.hasUserDJed(newDj.userid)) {
				cmbot.bot.pm(cmbot.options.new_dj_message, newDj.userid);
				cmbot.addDJCount(newDj.userid);
			}
		}
		cmbot.users[newDj.userid].djing = true;
//		currentSong.room.metadata.djs.push(newDj.userid);
		cmbot.users[newDj.userid].refresh = false;
		clearTimeout(cmbot.users[newDj.userid].timers.queueTimer);
		cmbot.users[newDj.userid].timers.queueTimer = false;
		cmbot.session.djs.push(newDj.userid);
		
		cmbot.checkQueue();
		cmbot.autodj();
		
		if(typeof cmbot.customEvents['add_dj'] == 'function') {
			cmbot.customEvents['add_dj'](data);
		}
	});
};

cmbot.prototype.autodj = function() {
	var cmbot = this;
	// If autodj is on, there are 2 or more spots open, the bot isn't dj'ing, and there is nobody in the queue, go ahead and dj.
	log("Checking to see if I should autodj.");
	var freeSpots = cmbot.session.max_djs - cmbot.session.djs.length;
	if(cmbot.session.djing)
		log("I'm already DJ'ing.");
	else if(!cmbot.session.autodj)
		log("AutoDJ is off.");
	else if(freeSpots < 2) 
		log("There " + (freeSpots == 1 ? "is " + freeSpots + " spot" : "are " + freeSpots + " spots") + " free. (max djs: " + cmbot.session.max_djs + ", num djs: " + cmbot.session.djs.length + ")");
	else if(cmbot.q.getQueueLength(true) != 0)
		log("There is someone in the queue.");
	else {
		log("Setting timer to autodj");
		cmbot.session.timers.autodj = setTimeout(function() {
			// Make sure the previous conditions are still true before actually dj'ing
			if(cmbot.session.max_djs - cmbot.session.djs.length >= 2 && !cmbot.session.djing && cmbot.q.getQueueLength(true) == 0) {
				log("Autodj'ing!");
				cmbot.bot.addDj(function(result) {
					if(result.success) {
						cmbot.session.autodjing = true;
						cmbot.users[cmbot.options.bot.userid].djing = true;
						cmbot.session.djing = true;
					}
				});
			}
		}, 60*1000);
	}
};

cmbot.prototype.eventRemDj = function() {
	var cmbot = this;
	cmbot.bot.on('rem_dj', function(data) {
		log(data.user[0].name + " just stepped down from the decks.");
		var user = cmbot.users[data.user[0].userid];
		if(user.userid == cmbot.options.bot.userid) {
			cmbot.session.djing = false;
			cmbot.session.autodjing = false;
		}
//		delete currentSong.room.metadata.djs[data.user[0].userid];
		cmbot.session.djs.splice(cmbot.session.djs.indexOf(user.userid), 1);
		if (!user.refresh && !user.escorted) {
			user.playcount = 0;
			user.djing = false;
			user.lastInteraction = now();
			clearTimeout(user.timers.idleDJRemove);
			user.timers.idleDJRemove = false;
			cmbot.savePlayCounts();
			
			
		} else if(user.escorted) {
			user.escorted = false;
			user.djing = false;
		}
		// Alert the first non-afk person that they are up
		if(!user.refresh) {
			cmbot.checkQueue();
			cmbot.autodj();
		}

		user.escortme = false;
		
		
		if(typeof cmbot.customEvents['rem_dj'] == 'function') {
			cmbot.customEvents['rem_dj'](data);
		}
	});
};

cmbot.prototype.eventUpdateUser = function() {
	var cmbot = this;
	cmbot.bot.on('update_user', function(data) {
//		log("User updated: %o", data);
		if(data.name != null) {
			// User changed their name
			cmbot.users[data.userid].name = data.name;
		}
		if(typeof cmbot.customEvents['update_user'] == 'function') {
			cmbot.customEvents['update_user'](data);
		}
	});
};

cmbot.prototype.eventNewModerator = function() {
	var cmbot = this;
	cmbot.bot.on('new_moderator', function(data) {
		log("A user was given mod: ", data);
		var userid = data.userid;
		cmbot.users[userid].mod = true;
		cmbot.mods[userid] = 1;
		if(typeof cmbot.customEvents['new_moderator'] == 'function') {
			cmbot.customEvents['new_moderator'](data);
		}
	});
};

cmbot.prototype.eventRemModerator = function() {
	var cmbot = this;
	cmbot.bot.on('rem_moderator', function(data) {
		log("A user was unmodded: ", data);
		var userid = data.userid;
		cmbot.users[userid].mod = false;
		delete cmbot.mods[userid];
		if(typeof cmbot.customEvents['rem_moderator'] == 'function') {
			cmbot.customEvents['rem_moderator'](data);
		}
	});
};

cmbot.prototype.eventRegistered = function() {
	var cmbot = this;
	this.bot.on('registered', function(data) {
		var userid = data.user[0].userid;
		log(data.user[0].name + " just joined.");

		if (cmbot.settings.shitlist[userid] != null) {
			log("shitlisted user just joined, booting");
			cmbot.bot.bootUser(userid, cmbot.settings.shitlist[userid].reason + " http://goo.gl/krnve");
			return false;
		}
		else {
			if (typeof cmbot.users[data.user[0].userid] != 'object') {
				user = new User({userid: data.user[0].userid, name: data.user[0].name, mod: cmbot.mods[data.user[0].userid] == 1 || data.user[0].acl > 0});
				if(data.user[0].acl > 0 && cmbot.mods.indexOf(data.user[0].userid) == -1)
					cmbot.mods[data.user[0].userid] = 1;
				cmbot.users[data.user[0].userid] = user;
			}
			else {
				cmbot.users[data.user[0].userid].present = true;
				cmbot.users[data.user[0].userid].lastInteraction = now();
				if(cmbot.users[userid].timers.removeFromQueue !== false) {
					log("Clearing removeFromQueue timer for " + data.user[0].name + ".");
					clearTimeout(cmbot.users[userid].timers.removeFromQueue);
					cmbot.users[userid].timers.removeFromQueue = false;
				}

			}
		}
		if(typeof cmbot.customEvents['registered'] == 'function') {
			cmbot.customEvents['registered'](data);
		}
	});
};

cmbot.prototype.eventDeregistered = function() {
	var cmbot = this;
	this.bot.on('deregistered', function(data) {
		var thisUser = cmbot.users[data.user[0].userid];
		try {
			thisUser.present = false;
			var userInQueue = false;
			$(cmbot.q.getQueue()).each(function(index, userid) {
				if (userid == thisUser.userid) 
					userInQueue = true;
			});
			if (userInQueue && !thisUser.refresh) {
//				thisUser.afk = true;
				log("User in queue, " + thisUser.name + ", just left the room. Setting up timer to remove them from the queue in 5 minutes if they don't leave.");
				thisUser.timers.removeFromQueue = setTimeout(function(){
					log(thisUser.name + " left the room 5 minutes ago and hasn't returned, removing from the queue.");
					cmbot.q.removeUser(thisUser);
				}, 60 * 5000);
			}
		} catch(e) {
			log("Exception checking queue after user leaves room: ", e);
		}	
		if(typeof cmbot.customEvents['deregistered'] == 'function') {
			cmbot.customEvents['deregistered'](data);
		}
	});
};

cmbot.prototype.eventTcpConnect = function() {
	var cmbot = this;
	this.bot.on('tcpConnect', function (socket) {
		if(typeof cmbot.customEvents['tcpConnect'] == 'function') {
			cmbot.customEvents['tcpConnect'](socket);
		}
	});
};

cmbot.prototype.eventTcpMessage = function() {
	var cmbot = this;
	this.bot.on('tcpMessage', function (socket, msg) {
		if(typeof cmbot.customEvents['tcpMessage'] == 'function') {
			cmbot.customEvents['tcpMessage'](socket, msg);
		}
	});
};

cmbot.prototype.eventTcpEnd = function() {
	var cmbot = this;
	this.bot.on('tcpEnd', function (socket) {
		if(typeof cmbot.customEvents['tcpEnd'] == 'function') {
			cmbot.customEvents['tcpEnd']();
		}
	});
};

cmbot.prototype.eventHttpRequest = function() {
	var cmbot = this;
	this.bot.on('httpRequest', function (request, response) {
		if(typeof cmbot.customEvents['httpRequest'] == 'function') {
			cmbot.customEvents['httpRequest'](request, response);
		}
	});
};

cmbot.prototype.randomizePlaylist = function(callback) {
	var cmbot = this;
	this.bot.playlistAll('default', function(res) {
		try {
			log("length: " + $(res.list).length);
			var plLength = $(res.list).length;
			// First song
			var r = getRandomNumber(20, plLength);
			cmbot.bot.playlistReorder('default', r, 0, function(result) {
				if(result.success) {
					r = getRandomNumber(20, plLength);
					cmbot.bot.playlistReorder('default', r, 1, function(result) {
						if(result.success) {
							r = getRandomNumber(20, plLength);
							cmbot.bot.playlistReorder('default', r, 2, function(result) {
								if(result.success) {
									r = getRandomNumber(20, plLength);
									cmbot.bot.playlistReorder('default', r, 3, function(result) {
										if(result.success) {
											if(typeof callback == 'function') {
												callback(true);
											}
										}
									});
								} else if(typeof callback == 'function') {
									callback(false);
								}
							});
						} else if(typeof callback == 'function') {
							callback(false);
						}
					});
				} else if(typeof callback == 'function') {
					callback(false);
				}
			});
		} catch(e) {}
	});
};

cmbot.prototype.speakOrPM = function(text, pm, userid) {
	if(pm)
		this.bot.pm(text, userid);
	else
		this.bot.speak(text);
};

cmbot.prototype.savePlayCounts = function() {
	var counts = {};
	$.each(this.users, function(userid, user) {
		try {
			if (user.djing) {
//				log("user: ", user);
//				counts.push(user.name + ": " + user.playcount);
				counts[user.userid] = user.playcount;
			}
		} catch(e) {}
	});
	this.settings.playcounts = counts;
	this.saveSettings();
};

cmbot.prototype.loadPlayCounts = function() {
	var cmbot = this;
	var counts = this.settings.playcounts;
	$.each(counts, function(userid, playcount) {
		if (typeof cmbot.users[userid] == 'object') {
			cmbot.users[userid].playcount = playcount;
		}
	});
};

cmbot.prototype.reactToSpeak = function(data) {
	var cmbot = this;
	// Just react to ++ and --
	var text = data.text;
	if(text.match(/^([^\+]+)\+\+$/)) {
		log("got here");
		var phrase = RegExp.$1;
		if(cmbot.settings.phrases[phrase] == undefined)
			cmbot.settings.phrases[phrase] = 1;
		else
			cmbot.settings.phrases[phrase]++;
		cmbot.bot.speak(phrase + " has a score of " + cmbot.settings.phrases[phrase]);
		cmbot.saveSettings();
	} else if(text.match(/^([^\-]+)\-\-$/)) {
		var phrase = RegExp.$1;
		if(cmbot.settings.phrases[phrase] == undefined)
			cmbot.settings.phrases[phrase] = -1;
		else
			cmbot.settings.phrases[phrase]--;
		cmbot.bot.speak(phrase + " has a score of " + cmbot.settings.phrases[phrase]);
		cmbot.saveSettings();
	}
};

cmbot.prototype.getUserByName = function(name) {
	var foundUser = false;
	$.each(this.users, function(userid, user) {
		try {
			if (user.name.toLowerCase() == name.toLowerCase()) 
				foundUser = user;
		} catch(e) {
			log("EXCEPTION! ", e);
		}
	});
	return foundUser;
};

cmbot.prototype.on = function(event, callback) {
	this.customEvents[event] = callback;
};

cmbot.prototype.reactToCommand = function(data) {
	var cmbot = this;
	// Get the data
	var text = data.text;

	var command = arg = '';
	if(text.match(/^\/([^ ]+)\s{0,1}(.*)$/)) {
		command = RegExp.$1;
		arg = RegExp.$2;
//		if(arg != '')
//			log("arg = " + arg);
	}
	command = command.toLowerCase();
	
	if(cmbot.commandAliases[command] != undefined)
		command = cmbot.commandAliases[command];
	
	if(cmbot.commandTimestamps[command] != undefined) {
		if ((now() - cmbot.commandTimestamps[command]) / 1000 < cmbot.commandTimeLimits[command]) {
			// it's been less than the time limit for this command, so don't bother doing anything
			log("less than " + cmbot.commandTimeLimits[command] + " seconds have passed since " + command + " was last run.");
			return false;
		}
	}
	cmbot.commandTimestamps[command] = now();
	
	
	if(command == '' || command == 'me' || cmbot.users[data.userid] == undefined)
		return;
	
	var theCommand = false;
	if(typeof cmbot.commands[command] == 'object') {
		theCommand = cmbot.commands[command];
	} else if(typeof cmbot.customCommands[command] == 'object') {
		theCommand = cmbot.customCommands[command];
	}
	
	if(theCommand !== false) {
		log("found command: " + command);
		if(typeof theCommand.command == 'function') {
			if(!theCommand.modonly || cmbot.users[data.userid].mod) {
				if(!theCommand.pmonly)
					theCommand.command({ cmbot: cmbot, pm: false, arg: arg, userid: data.userid });
				else
					cmbot.bot.pm("Sorry, that command is only available in PM.", data.userid);
				return;
			}
		}
	}
	if(cmbot.settings.triggers[escape(command)] != undefined) {
		var userid = data.userid;
		cmbot.doTrigger(userid, command);
	}
};

function now() {
	return new Date().getTime();
}

function escapeRegExp(str) {
	return str.replace(/[-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function getRandomNumber(min, max) {
	var r = Math.floor((max - min - 1) * Math.random()) + min;
	return r;
}

cmbot.prototype.hasUserDJed = function(userid) {
	try {
		var json = fs.readFileSync(this.options.dj_file);
		var djs = JSON.parse(json);
		if (djs[userid] == undefined) 
			return false;
		else 
			return true;
	} catch(e) {
		return false;
	}
};

cmbot.prototype.addDJCount = function(userid) {
	var json = '';
	try {
		json = fs.readFileSync(this.options.dj_file);
	} catch(e) {}
	var djs;
	if(json == '')
		djs = {};
	else
		djs = JSON.parse(json);
	if(djs[userid] == undefined)
		djs[userid] = 1;
	try {
		fs.writeFileSync(this.options.dj_file, JSON.stringify(djs));
	} catch(e) {}
	djs = null;
};

cmbot.prototype.doTrigger = function(userid, command) {
	var cmbot = this;
	if(cmbot.settings.triggerBan[userid] != undefined) {
		if(cmbot.settings.triggerBan[userid] < now())
			delete cmbot.settings.triggerBan[userid];
		else
			return false;
	}
	if ((now() - cmbot.triggerTimeStamps[command]) / 1000 < cmbot.settings.triggerLimit[command]) {
		// it's been less than the time limit for this command, so don't bother doing anything
		log("less than " + cmbot.settings.triggerLimit[command] + " seconds have passed since " + cmbot.command + " was last run.");
		return false;
	}
	cmbot.triggerTimeStamps[command] = now();
	var djName = cmbot.users[cmbot.currentSong.room.metadata.current_dj] != undefined ? cmbot.users[cmbot.currentSong.room.metadata.current_dj].name : '';
	cmbot.bot.speak(cmbot.settings.triggers[command].replace(/%me%/g, '@' + cmbot.users[userid].name).replace(/%dj%/g, '@' + djName));
};

cmbot.prototype.initQueue = function() {
	var cmbot = this;
	cmbot.q = new Queue(cmbot, function(queueArray) {
		cmbot.settings.queue = queueArray;
		cmbot.saveSettings();
	});
	this.q.setQueue(this.settings.queue);
//	log("q = ", this.q);
};

cmbot.prototype.loadSettings = function() {
	var _settings = {};
	try {
		var json = fs.readFileSync(this.options.settings_file);
		_settings = JSON.parse(json);
	} catch(e) {
		log("Exception: %o", e);
	}
	return _settings;
};

cmbot.prototype.saveSettings = function() {
	try {
		fs.writeFileSync(this.options.settings_file, JSON.stringify(this.settings));
	} catch(e) {
		log("Exception saving settings: %o", e);
	}
};

cmbot.prototype.initOptions = function(_options) {
	// First, try to open the settings and djs files, or create them if they don't exist
	$.each([_options.settings_file, _options.dj_file], function(index, file) {
		if(!path.existsSync(file)) {
			fs.writeFileSync(file, "{}");
		}
	});

	this.options = $.extend({
		settings_file: false,
		dj_file: false,
		
		autodj: true,
		queue_enabled: true,
		bot: false,
		set_limit: 0,
		snag_threshold: 10, // How many votes a song must get for the bot to add it to it's queue.
		master_userid: false, // Who runs the bot should have extra privileges
		ffa: false, // Day of the week for free for all. Sunday = 0, Monday = 1, etc. Set to false for none.
		ffa_text: false,
		timezone: 'PST',
		lastfm: {
			enabled: false,
			earliest_scrobble: ''
		},
		songkick: false,
		google: {
			url_shorten_api_key: 'AIzaSyCgS_W9UZYBhl3d8cLxxPYo1IaX6WzwJbc'
		},
		mysql: {
			enabled: false, // Change to true and fill out details below to enable mysql logging of song plays
			host: '',
			database: '',
			user: '',
			password: ''
		},
		/*
		 * Messages:
		 * This should be an array of text that the bot will say in the chat room periodically, such as reminding users of the rules, how the queue works, etc.
		 */
		messages: [],
		/*
		 * Sets how often the messages should display, in minutes. After the bot starts up, it waits the interval time,
		 * then speaks the first message (in the array above) out into chat. It then waits the interval time again until displaying
		 * the next message in the array (if there is one). So, the amount of time between each time a specific message is displayed is dependent on both
		 * the message interval (defined below) and the number of different messages in the array. If there are two messages, and the interval
		 * is 15 minutes each message will be displayed every 30 minutes - the first one 15 minutes after the bot starts, and the next
		 * one 15 minutes later, then the first one in another 15 minutes, etc.
		 */
		message_interval: 15, // Number of minutes between each informational message
		messages_hide_ffa: [], // index of which messages should be hidden when it's FFA (free for all) mode (if the queue is disabled, this setting doesn't do anything - every message will display)
		/*
		 * Events:
		 * You can program your own logic here when certain turntable events happen. Simply add a new entry like the ones below.
		 * Events supported: speak, ready, roomChanged, update_votes, newsong, endsong, pmmed, add_dj, rem_dj, update_user, new_moderator, rem_moderator, registered, deregistered
		 * See Alain Gilbert's TTAPI (which this bot uses) for more details on what each event is for at https://github.com/alaingilbert/Turntable-API
		 * The options object looks like this:
		 * {
		 * 		bot: (the bot object - you can use the methods from the TTAPI page above to make the bot do things, like speak in chat or PM someone)
		 * 		data: (the data that particular event receives from turntable. Each event gets it's own unique data object, so use console to output it for a particlar event to get an idea)
		 * 		users: (An object containing every user the bot is aware of. This object is keyed on the user's id, so users['109f909109ea091959fa'] for instance is an object containing some information about that user, like their name, mod status, playcount, etc.)
		 * }
		 */
		events: false,
		/*
		 * The first time a user dj's in your room, you can have the bot PM them an introductory message, for instance to remind them of what type of music is welcome in the room. to disable, just set this to false.
		 */
		 new_dj_message: false,
		 twitter: false
	}, _options);
//	log("options: ", this.options);
};

/*
 * TODO: allow overriding the strings of text the bot speaks/pm's
cmbot.prototype.setStrings = function(strings) {
	strings = strings || {};
	var newstrings = $.extend({
		test: "foo %something% bar %yeah% blah %four%"
	}, strings);
	this.strings = newstrings;
};

cmbot.prototype.getString = function() {
	var arg = arguments[0];
	var string = this.strings[arg];
	for(var i=1;i<arguments.length;i++) {
		string = string.replace('%' + i, arguments[i]);
	}
	return string;
};
*/

cmbot.prototype.shortenUrl = function(url, callback) {
	post_data = '{"longUrl": "' + url + '"}';
	var options = {
		host: 'www.googleapis.com',
		port: '443',
		path: '/urlshortener/v1/url?key=' + this.options.google.url_shorten_api_key,
		method: 'POST',
		headers: {
			'Content-Length': post_data.length,
			'Content-Type': 'application/json'
		}
	};
	options.agent = new https.Agent(options);
	
	var req = https.request(options, function(res) {
		res.setEncoding('utf8');
		res.on('data', function(d) {
			var result = JSON.parse(d);
			if(typeof callback == 'function') {
				if(result.id != undefined) {
					callback({
						success: true,
						url: result.id
					});
				} else {
					callback({
						success: false,
						error: result.error.message
					});
				}
			}
		});
	});
	req.write(post_data);
	req.end();
};

cmbot.prototype.getUptime = function() {
	var now = new Date();
	var diff = now.getTime() - this.session.start_time.getTime();
	var x = diff / 1000;
	var seconds = Math.floor(((x % 86400) % 3600) % 60);
	var minutes = Math.floor(((x % 86400) % 3600) / 60);
	var hours = Math.floor((x % 86400) / 3600);
	var days = Math.floor(x / 86400);
	var uptime = 'up ';
	if(days == 1)
		uptime += days + ' day, ';
	else if(days > 1)
		uptime += days + ' days, ';
	if(hours > 0)
		uptime += sprintf("%02d", hours) + ":" + sprintf("%02d", minutes);
	else if(minutes > 0)
		uptime += minutes + ' mins';
	else
		uptime += seconds + ' secs';
	return uptime;
};

/*
 * Set up informational messages
 */
cmbot.prototype.setupMessages = function() {
	var cmbot = this;
	if(isNaN(this.options.message_interval)) {
		log("interval is bad");
	} else {
		var modifier = 1000*60; // 1 minute
		$.each(this.options.messages, function(index, message) {
			var interval = cmbot.options.message_interval*cmbot.options.messages.length*modifier;
			setTimeout(function() {
				if(!cmbot.isFFA() || cmbot.options.messages_hide_ffa[index] == undefined || !cmbot.options.queue_enabled) {
					cmbot.bot.speak(cmbot.options.messages[index]);
					log("Displaying message: " + index);
				}
				setInterval(function() {
					if(!cmbot.isFFA() || this.options.messages_hide_ffa[index] == undefined) {
						log(index + ": Displaying messages: " + cmbot.options.messages[index]);
						cmbot.bot.speak(cmbot.options.messages[index]);
					}
				}, interval);
			}, cmbot.options.message_interval*(index == 0 ? 1 : index+1)*modifier);
		});
	}
};

cmbot.prototype.modpm = function(text, modsToPm, from, fromBot) {
	var cmbot = this;
	fromBot = fromBot !== true ? false : fromBot;
	if(modsToPm === false) {
		modsToPm = [];
		$.each(cmbot.mods, function(each_userid) {
			if(cmbot.users[each_userid] != undefined && cmbot.users[each_userid].present && each_userid != from && each_userid != cmbot.options.bot.userid) {
				modsToPm.push(each_userid);
			}
		});
	}
	if(modsToPm.length > 0) {
		var mod = modsToPm[0];
		mod = cmbot.users[mod];
		var date = new Date();
		if(cmbot.settings.timezones[mod.userid] != undefined) {
			var offset = date.stdTimezoneOffset() / 60;
			var userTimezone = cmbot.settings.timezones[mod.userid];
			var userOffsetNum = cmbot.timezones[userTimezone];
			if(userOffsetNum.indexOf('-') > -1) {
				userOffsetNum = parseInt(userOffsetNum.substr(1)) * -1;
			} else {
				userOffsetNum = parseInt(userOffsetNum);
			}
			date.setHours(date.getHours() + userOffsetNum + parseInt(offset));
		}
		var time = dateFormat(date, "h:MMtt");
		cmbot.bot.pm((!fromBot ? "[" + cmbot.users[from].name + "] " : "") + "[" + time + "]: " + text, mod.userid, function(result) {
			log("sent pm to " + mod.name);
			modsToPm.splice(0, 1);
			cmbot.modpm(text, modsToPm, from, false);
		});
	}
};

cmbot.prototype.yoinkTrack = function(callback) {
	var cmbot = this;
	if(!this.options.lastfm.enabled || this.lastfm === false) {
		cmbot.bot.snag();
		cmbot.bot.playlistAdd(cmbot.currentSong.room.metadata.current_song['_id']);
		cmbot.session.snagged = true;
	} else {
		this.lastfm.getTrackInfo({
			artist: cmbot.currentSong.room.metadata.current_song.metadata.artist,
			track: cmbot.currentSong.room.metadata.current_song.metadata.song,
			callback: function(result) {
	//			log("Trackinfo result: ", result);
				if(!result.success) {
					if(typeof callback == 'function') {
						callback({
							success: false,
							error: result.error
						});
					}
				} else {
					if(result.trackInfo.userloved == '0') {
						cmbot.lastfm.loveTrack({
							artist: cmbot.currentSong.room.metadata.current_song.metadata.artist,
							track: cmbot.currentSong.room.metadata.current_song.metadata.song,
							callback: function(result) {
								if(result.success) {
									cmbot.bot.snag();
									cmbot.bot.playlistAdd(cmbot.currentSong.room.metadata.current_song['_id']);
									cmbot.session.snagged = true;
								}
								if(typeof callback == 'function')
									callback(result);
							}
						});
					} else {
						cmbot.session.snagged = true;
						if(typeof callback == 'function') {
							callback({
								success: false,
								error: cmbot.q.ALREADY_YOINKED
							});
						}
					}
				}
			}
		});
	}
};

cmbot.prototype.getPlayCounts = function() {
	var cmbot = this;
	var counts = [];
	$(this.session.djs).each(function(index, userid) {
		try {
			var user = cmbot.users[userid];
			if (user.djing) {
				counts.push(user.name + ": " + user.playcount);
			}
		} catch(e) {
		}
	});
	return counts;
};

cmbot.prototype.getMysqlClient = function() {
	var cmbot = this;
	var mysql = require('mysql').createClient({
		host: cmbot.options.mysql.host,
		user: cmbot.options.mysql.user,
		password: cmbot.options.mysql.password
	});
	mysql.query('USE ' + cmbot.options.mysql.database);
	return mysql;
};

//If there are any open spots, and any non-afker's in the queue, do the timer.
cmbot.prototype.checkQueue = function() {
	log("Checking queue.");
	var cmbot = this;
	if($(this.session.djs).length < cmbot.session.max_djs) {
		if (this.q.getQueueLength() > 0 && this.session.enforcement) {
			var foundUser = false;
			$(this.q.getQueue()).each(function(index, userid){
				var user = cmbot.users[userid];
				if (user != undefined) {
//					log("user = ", user);
					if (!foundUser) {
						if (user.userid == cmbot.options.bot.userid) {
							// The bot is next in queue, so step up
							cmbot.bot.addDj();
							foundUser = true;
						}
						else {
							if (!user.afk && user.present && !user.djing && user.timers.queueTimer === false) {
								cmbot.bot.speak("@" + user.name + " has three minutes to step up.");
								user.timers.queueTimer = setTimeout(function(){
									cmbot.checkQueue();
								}, 60000 * 3);
								foundUser = true;
							} else if(user.djing) {
								cmbot.q.removeUser(user);
							} else if(user.timers.queueTimer !== false) {
								foundUser = true;
							}
						}
					}
				}
			});
		}
	}
};

cmbot.prototype.isFFA = function() {
	var day = new Date().getDay();
	if(this.options.ffa === false)
		return false;
	if(this.options.ffa.indexOf(day) == -1)
		return false;
	else
		return true;
};

cmbot.prototype.commands = {
	'setnext': {
		command: function(options) {
			if(!options.arg.match(/^[0-9]+$/)) {
				options.cmbot.bot.pm("Invalid syntax.", options.userid);
			} else {
				options.cmbot.bot.playlistReorder('default', parseInt(options.arg), 0, function(result) {
					log("Move result: ", result);
					if(result.success) {
						options.cmbot.bot.pm("Track moved.", options.userid);
					} else {
					}
				});
			}
		},
		modonly: true,
		pmonly: true,
		acl: true,
		help: 'Put a certain song (specified by index) at the front of my queue.'
	},
	'getnext': {
		command: function(options) {
			var playlistname = 'default';
			options.cmbot.bot.playlistAll(playlistname, function(res) {
//				try {
					var text = '';
					$(res.list).each(function(i, song) {
						if(i >= (options.cmbot.options.set_limit !== false ? options.cmbot.options.set_limit : 5))
							return false;
						log("Song: ", song);
						text += (i+1) + ': ' + song.metadata.artist + ' - ' + song.metadata.song + "\n";
					});
					if(text == '')
						text = 'Sorry, my queue is empty';
					options.cmbot.bot.pm(text, options.userid);
//				} catch(e) {
//					log("Exception getting playlist: ", e);
//				}
			});
		},
		modonly: true,
		pmonly: true,
		acl: true,
		help: 'Get the first 4 tracks on my queue.'
	},
	'avatar': {
		command: function(options) {
			if(avatars[options.arg] == 'undefined' || options.arg == '') {
				options.cmbot.bot.pm("Invalid argument. Type '/help avatar' for available arguments.", options.userid);
			} else {
				options.cmbot.bot.setAvatar(avatars[options.arg]);
			}
		},
		modonly: true,
		pmonly: true,
		acl: true,
		help: 'Set my avatar. Available options: ' + avatar_options.join(', ')
	},
	'playlist': {
		command: function(options) {
			options.cmbot.bot.playlistAll('default', function(res) {
				try {
					options.cmbot.bot.pm("I have " + res.list.length + " songs in my queue.", options.userid);
				} catch (e) {}
			});
		},
		modonly: true,
		pmonly: true,
		help: 'Show how many songs I have in my playlist.'
	},
	'queue': {
		command: function(options) {
			var text;
			if(options.cmbot.isFFA())
				text = options.cmbot.options.ffa_text;
			else
				text = options.cmbot.q.printQueue(true, options.cmbot.session.djs);
			if(options.pm)
				options.cmbot.bot.pm(text, options.userid);
			else
				options.cmbot.bot.speak(text);
		},
		modonly: false,
		pmonly: false,
		help: 'Show who is in the queue.'
	},
	'trigger': {
		command: function(options) {
			log("creating trigger: " + options.arg);
			if(options.arg.match(/^([^ ]+) (.*)$/)) {
				var trigger = RegExp.$1.toLowerCase();
				var saying = RegExp.$2;
				var text = '';
				var success = false;
				if(options.cmbot.commands[trigger] == undefined) {
					var preexisting = options.cmbot.settings.triggers[trigger] != undefined;
					log("trigger = " + trigger);
					log("saying = " + saying);
					options.cmbot.settings.triggers[trigger] = saying;
					options.cmbot.saveSettings();
					success = true;
					if (preexisting) {
						//bot.speak("Trigger updated.");
						text = 'updated';
						log(options.cmbot.users[options.userid].name + " updated trigger " + trigger);
					} else {
//						bot.speak("Trigger saved.");
						text = 'saved';
						log(options.cmbot.users[options.userid].name + " created trigger " + trigger);
					}
				} else {
					//bot.speak("That trigger is a command I already respond to!");
					text = 'That\'s a command I already respond to!';
				}
				if(success)
					options.cmbot.bot.pm("Trigger " + text + ".", options.userid);
				else
					options.cmbot.bot.pm(text, options.userid);
			}
		},
		modonly: true,
		pmonly: true,
		help: 'Add or update a trigger saying, to make me say something. Usage: /trigger <trigger> <saying>. <trigger> should be a single word, while <saying> can be any length. In <saying>, use %me% to have me use the name of the person who says the trigger command, and %dj% to have me say the name of the DJ whose song is currently playing. (Only mods can define a trigger, but anyone can use an already defined trigger.)'
	},
	'shitlist': {
		command: function(options) {
			if(options.arg == '') {
				options.cmbot.bot.pm("Usage: /shitlist username reason", options.userid);
				return false;
			}
			var result = false;
			var text = '';
			var mytext = '';
			var user = false;
			var reason = false;
			var arg = options.arg;
			$.each(options.cmbot.users, function(index, thisUser) {
				var regexp = new RegExp('^' + escapeRegExp(thisUser.name) + ' (.*)$', 'i');
				if(arg.match(regexp)) {
					user = thisUser;
					reason = RegExp.$1;
					return false;
				} else if(arg == thisUser.name) {
					user = thisUser;
					return false;
				}
			});
			if (user === false) {
				text = arg + " not found.";
			} else if(reason === false) {
				text = "Please specify a reason for shitlisting " + user.name + ".";
			} else if(user.userid == options.cmbot.options.master_userid) {
				text = 'I\'m sorry, Dave. I\'m afraid I can\'t do that.'; 
			} else {
				if(user.mod) {
					text = "I'm not going to shitlist a mod!";
				} else {
					if(options.cmbot.settings.shitlist[user.userid] != null) {
						text = user.name + " is already shitlisted.";
					} else {
						options.cmbot.settings.shitlist[user.userid] = {name: user.name, reason: reason, originator: {userid: options.userid, name: options.cmbot.users[options.userid].name}};
						options.cmbot.saveSettings();
						text = user.name + " has been shitlisted by " + options.cmbot.users[options.userid].name + ".";
						mytext = user.name + " has been shitlisted.";
						result = true;
						options.cmbot.bot.bootUser(user.userid, reason);
						options.cmbot.saveSettings();
					}
				}
			}
			if(typeof callback == 'function') {
				callback(result, text);
			}
			if(result) {
				options.cmbot.bot.pm(mytext, options.userid, function(result) {
					options.cmbot.modpm(text, false, options.userid, false);
				});
			} else {
				options.cmbot.bot.pm(text, options.userid);
			}
		},
		modonly: true,
		pmonly: false,
		help: 'Adds a user to the shitlist. This will immediately boot them from the room, and whenever they try to join they will get booted. Use only for trolls. You must specify a reason, and I will keep track of who shitlisted whom, so don\'t abuse it!'
	},
	'unshitlist': {
		command: function(options) {
			if(options.arg == '') {
				options.cmbot.bot.pm("Usage: /unshitlist <username>", options.userid);
				return false;
			}
			var found = false;
			$.each(options.cmbot.settings.shitlist, function(each_userid, obj) {
				if(obj.name.toLowerCase() == options.arg.toLowerCase()) {
					found = true;
					delete options.cmbot.settings.shitlist[each_userid];
					options.cmbot.saveSettings();
					options.cmbot.modpm(options.cmbot.users[options.userid].name + " has unshitlisted " + obj.name + ".", false, options.userid, false);
					options.cmbot.bot.pm(options.arg + " removed from shitlist.", options.userid);
				}
			});
			if(!found)
				options.cmbot.bot.pm(options.arg + " not found.", options.userid);
		},
		modonly: true,
		pmonly: false,
		help: 'Remove a user from the shitlist. Use /unshitlist user.'
	},
	'settimezone': {
		command: function(options) {
			if(options.cmbot.settings.timezones == undefined)
				options.cmbot.settings.timezones = {};
			if(options.cmbot.timezones[options.arg] == undefined) {
				options.cmbot.bot.pm("Invalid syntax.", options.userid);
			} else {
				options.cmbot.settings.timezones[options.userid] = options.arg;
				options.cmbot.saveSettings();
				options.cmbot.bot.pm("Your timezone has been set to " + options.arg + ".", options.userid);
			}
		},
		modonly: true,
		pmonly: true,
		help: ''
	},
	'gettimezone': {
		command: function(options) {
			if(options.cmbot.settings.timezones[options.userid] == undefined)
				options.cmbot.bot.pm("You have not set your timezone yet. Use /settimezone to do so.", options.userid);
			else
				options.cmbot.bot.pm("Your timezone is currently set as " + options.cmbot.settings.timezones[options.userid] + ".", options.userid);
		},
		modonly: true,
		pmonly: true,
		help: ''
	},
	'tags': {
		command: function(options) {
			if(options.cmbot.currentSong.room.metadata.current_song == undefined && options.arg == '') {
				options.cmbot.bot.pm("Nobody is DJ'ing!", options.userid);
			} else if(options.cmbot.session.current_song_tags !== false && options.arg == '') {
				log("Using cached tags");
				if(options.pm)
					options.cmbot.bot.pm(options.cmbot.session.current_song_tags, options.userid);
				else
					options.cmbot.bot.speak(options.cmbot.session.current_song_tags);
			} else {
				var artist = options.arg != '' ? options.arg : options.cmbot.currentSong.room.metadata.current_song.metadata.artist;
				var track = options.arg != '' ? false : options.cmbot.currentSong.room.metadata.current_song.metadata.song;
				options.cmbot.lastfm.getTags({
					artist: artist,
					track: track,
					callback: function(result) {
//						log("got tags: ", result);
						if(result.success) {
							var tags = [];
							$.each(result.tags, function(index, tag_obj) {
								tags.push(tag_obj.name);
							});
							var text = tags.length > 0 ? "Tags for " + (result.track == undefined ? result.artist : result.track + ' by ' + result.artist) + ': ' + tags.join(', ') : "No tags found.";
							if(options.arg == '')
								options.cmbot.session.current_song_tags = text;
							if(options.pm)
								options.cmbot.bot.pm(text, options.userid);
							else
								options.cmbot.bot.speak(text);
						} else {
							if(options.pm)
								options.cmbot.bot.pm(result.error + '.', options.userid);
							else
								options.cmbot.bot.speak(result.error + '.');
						}
					}
				});
			}
		},
		modonly: false,
		pmonly: false,
		help: 'Get tags from last.fm. Pass an artist as an argument for that artist\'s tags, or no arguments for the current song\'s tags.'
	},
	'plays': {
		command: function(options) {
			if(options.cmbot.currentSong.room.metadata.current_song == undefined && options.arg == '') {
				options.cmbot.bot.pm("Nobody is DJ'ing!", options.userid);
				return false;
			}
			var artist = '', track = '';
			if(options.cmbot.currentSong.room.metadata.current_song != undefined) {
				artist = options.cmbot.currentSong.room.metadata.current_song.metadata.artist;
				track = options.cmbot.currentSong.room.metadata.current_song.metadata.song;
			}
			if(arg != '') {
				if(arg.match(/^(.*) \> (.*)$/)) {
					artist = RegExp.$1;
					track = RegExp.$2;
				} else {
					artist = options.arg;
					track = false;
				}
			}
			if(options.cmbot.options.playsMode == 'lastfm') {
				options.cmbot.lastfm.getPlays({
					artist: artist,
					track: track,
					callback: function(result) {
//						log("plays result: ", result);
						if(result.success) {
							if(options.cmbot.session.scrobbled && options.arg == '')
								result.plays--;
							var text;
							if(track == false)
								text = "There " + (result.plays != 1 ? 'have' : 'has') + " been " + result.plays + " plays by " + artist + (options.cmbot.options.lastfm.earliest_scrobble != '' ? " since " + options.cmbot.options.lastfm.earliest_scrobble : "") + ".";
							else
								text = result.track + " by " + result.artist + " has been played " + result.plays + " time" + (result.plays != 1 ? 's' : '') + (options.cmbot.options.lastfm.earliest_scrobble != '' ? " since " + options.cmbot.options.lastfm.earliest_scrobble : "") + ".";
								options.cmbot.shortenUrl('http://www.last.fm/user/' + options.cmbot.lastfm.username + '/library/music/' + artist, function(result) {
									var url = 'http://www.last.fm/user/' + options.cmbot.lastfm.username + '/library/music/' + artist;
									if(result.success) {
										url = result.url;
									}
									text += ' ' + url;
									if(options.pm)
										options.cmbot.bot.pm(text, options.userid);
									else
										options.cmbot.bot.speak(text);
								});
						} else {
							if(options.pm)
								options.cmbot.bot.pm(result.error, options.userid);
							else
								options.cmbot.bot.speak(result.error);
						}
					}
				});
			} else if(options.cmbot.options.playsMode == 'mysql') {
				if(options.cmbot.options.mysql.enabled !== true) {
					options.cmbot.bot.pm("Sorry, local logging of song plays is not enabled.", options.userid);
					return false;
				}
				var mysql = options.cmbot.getMysqlClient();
				var query;
				if(track === false)
					query = "SELECT s.artist, COUNT(s.id) AS play_count FROM song s JOIN songlog sl ON sl.songid = s.id WHERE s.artist = '" + artist + "' group by s.artist";
				else
					query = "SELECT s.artist, s.track, COUNT(s.id) AS play_count FROM song s JOIN songlog sl ON sl.songid = s.id WHERE s.artist = '" + artist + "' AND s.track = '" + track + "' GROUP BY s.artist";
				mysql.query(query, function selectCb(err, results, fields) {
					if(err) {
						if(options.pm)
							options.cmbot.bot.pm("Sorry, something went wrong: " + err, options.userid);
						else
							options.cmbot.bot.speak("Sorry, something went wrong: " + err);
							options.cmbot.bot.speak("There have been 0 plays.");
					} else {
						var play_count = results.length > 0 ? results[0].play_count : 0;
						if(play_count > 0) {
							artist = results[0].artist;
							if(track !== false)
								track = results[0].track;
						}
						var text;
						if(track === false)
							text = "There " + (play_count != 1 ? 'have' : 'has') + " been " + play_count + " plays by " + artist + ".";
						else
							text = track + " by " + artist + " has been played " + play_count + " time" + (play_count != 1 ? 's' : '') + ".";
						if(options.pm)
							options.cmbot.bot.pm(text, options.userid);
						else
							options.cmbot.bot.speak(text);
					}
				});	
			} else {
				options.cmbot.bot.pm("Sorry, but my master didn't configure me properly to show song plays.", options.userid);
			}
		},
		modonly: false,
		pmonly: false,
		help: 'Look up (on last.fm) how many times a song or artist has been played in the room since January 10th, 2012. Usage: /plays [artist [> track]]. If artist and track are ommitted, the current song is looked up. Examples: /plays bonobo > black sands; /plays bonobo; /plays'
	},
	/*
	'newplays': {
		command: function(options) {
			if(options.cmbot.options.mysql.enabled !== true) {
				options.cmbot.bot.pm("Sorry, local logging of song plays is not enabled.", options.userid);
				return false;
			} else if(options.cmbot.currentSong.room.metadata.current_song == undefined && options.arg == '') {
				options.cmbot.bot.pm("Nobody's playing right now!", options.userid);
				return false;
			}
			var mysql = options.cmbot.getMysqlClient();
			var artist = '', track = '';
			if(options.cmbot.currentSong.room.metadata.current_song != undefined) {
				artist = options.cmbot.currentSong.room.metadata.current_song.metadata.artist;
				track = options.cmbot.currentSong.room.metadata.current_song.metadata.song;
			}
			if(arg != '') {
				if(arg.match(/^(.*) \> (.*)$/)) {
					artist = RegExp.$1;
					track = RegExp.$2;
				} else {
					artist = options.arg;
					track = false;
				}
			}
			var query;
			if(track === false)
				query = "SELECT s.artist, COUNT(s.id) AS play_count FROM temp_song s JOIN temp_songlog sl ON sl.songid = s.id WHERE s.artist = '" + artist + "' group by s.artist";
			else
				query = "SELECT s.artist, s.track, COUNT(s.id) AS play_count FROM temp_song s JOIN temp_songlog sl ON sl.songid = s.id WHERE s.artist = '" + artist + "' AND s.track = '" + track + "' GROUP BY s.artist";
			mysql.query(query, function selectCb(err, results, fields) {
				if(err) {
					if(options.pm)
						options.cmbot.bot.pm("Sorry, something went wrong: " + err, options.userid);
					else
						options.cmbot.bot.speak("Sorry, something went wrong: " + err);
						options.cmbot.bot.speak("There have been 0 plays.");
				} else {
					var play_count = results.length > 0 ? results[0].play_count : 0;
					if(play_count > 0) {
						artist = results[0].artist;
						if(track !== false)
							track = results[0].track;
					}
					var text;
					if(track === false)
						text = "There " + (play_count != 1 ? 'have' : 'has') + " been " + play_count + " plays by " + artist + ".";
					else
						text = track + " by " + artist + " has been played " + play_count + " time" + (play_count != 1 ? 's' : '') + ".";
					if(options.pm)
						options.cmbot.bot.pm(text, options.userid);
					else
						options.cmbot.bot.speak(text);
				}
			});	
		},
		modonly: false,
		pmonly: false
	},
	*/
	'setcount': {
		command: function(options) {
			if(options.arg.match('^(.*) ([0-3]+)$')) {
				var username = RegExp.$1;
				var newcount = RegExp.$2;
				var user = options.cmbot.getUserByName(username);
//				log("user = ", user);
//				log("newcount = " + newcount);
//				log("type = " + typeof user);
				if (typeof user == 'object') {
					if(!user.djing) {
						options.cmbot.bot.pm(user.name + " isn't DJ'ing right now!", options.userid);
						return false;
					}
//					log("setting count: " + arg);
					user.playcount = newcount;
					options.cmbot.savePlayCounts();
					options.cmbot.bot.pm("Play count for " + user.name + " set to " + newcount, options.userid);
				} else {
					options.cmbot.bot.pm("User not found.", options.userid);
				}
			} else {
				options.cmbot.bot.pm("Invalid syntax", userid);
			}
		},
		modonly: true,
		pmonly: true,
		help: 'Set the playcount for a user.'
	},
	'addme': {
		command: function(options) {
			if(!options.cmbot.options.queue_enabled) {
				var text = 'Sorry, I don\'t enforce a queue.';
				options.cmbot.speakOrPM(text, options.pm, options.userid);
				return false;
			}
			if (!options.cmbot.isFFA()) {
//				log("options: ", options);
				var result = options.cmbot.q.newAddUser(options.cmbot.users[options.userid]);
				log("result = ", result);
				if(!result.success) {
					if(result.code == options.cmbot.q.USER_IN_QUEUE) {
						if(options.pm)
							options.cmbot.bot.pm("You are number " + result.spot + " in the queue.", options.userid);
						else
							options.cmbot.bot.speak(options.cmbot.users[options.userid].name + " is number " + result.spot + " in the queue.");
					} else if(result.code == options.cmbot.q.USER_ON_DECKS) {
						if(options.pm)
							options.cmbot.bot.pm("You're already DJ'ing!", options.userid);
						else
							options.cmbot.bot.speak("You're already DJ'ing, " + options.cmbot.users[options.userid].name + "!");
					}
				} else {
					options.cmbot.bot.speak(result.queue);
					options.cmbot.checkQueue();
					if(options.cmbot.session.timers.autodj !== false) {
						log("resetting autodj timer");
						clearTimeout(options.cmbot.session.timers.autodj);
						options.cmbot.session.timers.autodj = false;
					}
					if(options.cmbot.session.djing) {
						if(options.cmbot.session.autodjing && options.cmbot.currentSong.room.metadata.current_dj != options.cmbot.options.bot.userid && options.cmbot.session.max_djs == options.cmbot.session.djs.length) {
							// The bot is on the decks but isn't playing a song, and the decks are full, so step down.
							log("autodj: someone added to queue and I am autodj'ing so I'm stepping down.");
							options.cmbot.bot.remDj(options.cmbot.options.bot.userid);
						}
					}
				}
			} else {
				options.cmbot.bot.pm(options.cmbot.options.ffa_text, options.userid);
			}
		},
		modonly: false,
		pmonly: false,
		help: 'Add yourself to the queue.'
	},
	'about': {
		command: function(options) {
			options.cmbot.speakOrPM("CMBot version " + options.cmbot.VERSION + " written by Chris Bellew (atomjack). https://github.com/atomjack/cmbot", options.pm, options.userid);
		},
		modonly: false,
		pmonly: false,
		help: 'About me.'
	},
	'removeme': {
		command: function(options) {
			if(!options.cmbot.options.queue_enabled) {
				var text = 'Sorry, I don\'t enforce a queue.';
				options.cmbot.speakOrPM(text, options.pm, options.userid);
				return false;
			}
			if (!options.cmbot.isFFA()) {
				var result = options.cmbot.q.newRemoveUser(options.userid);
				log("result: ", result);
				if(result.success) {
					if(options.pm)
						options.cmbot.bot.pm("You have been removed from the queue.", options.userid);
					else
						options.cmbot.bot.speak("You have been removed from the queue, " + options.cmbot.users[options.userid].name + ".");
					options.cmbot.saveSettings();
					options.cmbot.checkQueue();
					options.cmbot.autodj();
				} else if(result.code == options.cmbot.q.USER_NOT_IN_QUEUE) {
					if(options.pm)
						options.cmbot.bot.pm("You aren't in the queue!", options.userid);
					else
						options.cmbot.bot.speak("You aren't in the queue, " + options.cmbot.users[options.userid].name + "!");
				}
			} else {
				if(options.pm)
					options.cmbot.bot.pm("It's Free For All Friday! No Queue today.", options.userid);
				else
					options.cmbot.bot.speak(options.cmbot.options.ffa_text);
			}
		},
		modonly: false,
		pmonly: false,
		help: 'Remove yourself from the queue.'
	},
	'searchplaylist': {
		command: function(options) {
			if(options.arg.length <= 3) {
				options.cmbot.bot.pm("Please use a search term of more than 3 characters.", options.userid);
			} else {
				var playlistname = 'default';
				options.cmbot.bot.playlistAll(playlistname, function(res) {
					try {
						var matches = 0;
						var i = 0;
						$(res.list).each(function(i, song) {
							var search_terms = options.arg.split(' ');
							var matched = true;
							$.each(search_terms, function(index, term) {
								var re = new RegExp(term, 'gi');
								if(!song.metadata.artist.match(re) && !song.metadata.song.match(re)) {
									matched = false;
								}
							});
							if(matched) {
								options.cmbot.bot.pm(i + ": " + song.metadata.artist + ' - ' + song.metadata.song, options.userid);
								matches++;
							}
						});
						i++;
						if(matches == 0)
							options.cmbot.bot.pm("Sorry, nothing found.", options.userid);
					} catch(e) {}
				});
			}
		},
		modonly: true,
		pmonly: true,
		acl: true,
		help: ''
	},
	'removesong': {
		command: function(options) {
			log("got here");
			if (!options.arg.match(/^[0-9]+$/)) {
				options.cmbot.bot.pm("Invalid number.", options.userid);
			} else {
				options.cmbot.bot.playlistRemove('default', parseInt(options.arg), function(result) {
					log("trying to remove song " + options.arg + ": ", result);
					if(result.success)
						options.cmbot.bot.pm("Removed song.", options.userid);
					else
						options.cmbot.bot.pm("Erm, something went wrong: " + result.err, options.userid);
				});
				
			}
		},
		modonly: true,
		pmonly: true,
		acl: true,
		help: ''
	},
	'shortenurl': {
		command: function(options) {
			var regexp = /(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;
			if(!regexp.test(options.arg)) {
				options.cmbot.bot.pm("Invalid URL.", options.userid);
			} else {
				options.cmbot.shortenUrl(options.arg, function(res) {
					if(res.success) {
						options.cmbot.bot.pm(res.url, options.userid);
					} else {
						options.cmbot.bot.pm("Something went wrong, sorry.", options.userid);
					}
				});
			}
		},
		modonly: false,
		pmonly: true,
		help: 'Shorten an URL with Google\'s URL Shortener.'
	},
	'addacl': {
		command: function(options) {
//			settings.acl = {};
//			this.saveSettings();
//			return false;
//			settings.acl = settings.acl || {};
			if(!options.arg.match(/^([^ ]+) (.*)$/)) {
				options.cmbot.bot.pm("Please specify arguments.", options.userid);
			} else {
				var acl_command = RegExp.$1;
				var user = options.cmbot.getUserByName(RegExp.$2);
				if(user === false) {
					options.cmbot.bot.pm("User " + RegExp.$2 + " not found.", options.userid);
				} else if(options.cmbot.commands[acl_command] == undefined) {
					options.cmbot.bot.pm("Command /" + acl_command + " not found.", options.userid);
				} else {
					options.cmbot.settings.acl[acl_command] = options.cmbot.settings.acl[acl_command] || {};
					if(options.cmbot.settings.acl[acl_command][user.userid] != undefined) {
						options.cmbot.bot.pm(user.name + " already has access to /" + acl_command + ".", options.userid);
					} else {
						options.cmbot.settings.acl[acl_command][user.userid] = user.name;
						options.cmbot.saveSettings();
						options.cmbot.bot.pm("You now have access to the command /" + acl_command + ".", user.userid, function(result) {
							options.cmbot.bot.pm(user.name + " now has access to /" + acl_command + ".", options.userid);
						});
					}
				}
			}
		},
		modonly: true,
		pmonly: true,
//		acl: [this.options.master_userid]
	},
	'remacl': {
		command: function(options) {
			if(!options.arg.match(/^([^ ]+) (.*)$/)) {
				options.cmbot.bot.pm("Please specify arguments.", options.userid);
			} else {
				var acl_command = RegExp.$1;
				var user = options.cmbot.getUserByName(RegExp.$2);
				if(user === false) {
					options.cmbot.bot.pm("User " + RegExp.$2 + " not found.", options.userid);
				} else if(options.cmbot.commands[acl_command] == undefined) {
					options.cmbot.bot.pm("Command /" + acl_command + " not found.", options.userid);
				} else if((acl_command == 'addacl' || acl_command == 'remacl') && user.userid == this.options.master_userid) {
					options.cmbot.bot.pm("Sorry, I can't do that.", options.userid); // Don't allow the master user of the bot to remove access to addacl or remacl
				} else {
					options.cmbot.settings.acl[acl_command] = options.cmbot.settings.acl[acl_command] || [];
					if(options.cmbot.settings.acl[acl_command][user.userid] != undefined) {
						options.cmbot.bot.pm(user.name + " no longer has access to /" + acl_command + ".", options.userid);
						delete options.cmbot.settings.acl[acl_command][user.userid];
						options.cmbot.saveSettings();
					} else {
						options.cmbot.bot.pm(user.name + " already doesn't have access to /" + acl_command + ".", options.userid);
					}
				}
			}
			options.cmbot.saveSettings();
		},
		modonly: true,
		pmonly: true,
	},
//	'getacl': {
//		command: function(options) {
//			if(cmbot.commands[options.arg] == undefined) {
//				bot.pm("Command not found.", options.userid);
//			} else {
////				var arr = [];
////				log("")
//			}
//		},
//		modonly: true,
//		pmonly: true,
//		acl: true
//	},
	'remove': {
		command: function(options) {
			if(!options.cmbot.options.queue_enabled) {
				var text = 'Sorry, I don\'t enforce a queue.';
				options.cmbot.speakOrPM(text, options.pm, options.userid);
				return false;
			}
			if (!options.cmbot.isFFA()) {
				if(options.arg == '') {
					options.cmbot.bot.pm("Usage: /remove username", options.userid);
				} else {
					var user = options.cmbot.getUserByName(options.arg);
					if(user === false) {
						options.cmbot.bot.pm("User not found.", options.userid);
					} else {
						var result = options.cmbot.q.newRemoveUser(user.userid);
						if(result.success) {
							options.cmbot.bot.pm(user.name + " removed from queue.", options.userid);
							options.cmbot.saveSettings();
							options.cmbot.checkQueue();
							options.cmbot.autodj();
						} else if(result.code == options.cmbot.q.USER_NOT_IN_QUEUE) {
							var text = user.name + " is not in the queue!";
							if(options.userid == user.userid)
								text = "You are not in the queue!";
							options.cmbot.bot.pm(text, options.userid);
						}
					}
				}
			} else {
				options.cmbot.bot.pm(options.cmbot.options.ffa_text, options.userid);
			}
		},
		modonly: true,
		pmonly: true
	},
	'add': {
		command: function(options) {
			if(!options.cmbot.options.queue_enabled) {
				var text = 'Sorry, I don\'t enforce a queue.';
				options.cmbot.speakOrPM(text, options.pm, options.userid);
				return false;
			}
			if (!options.cmbot.isFFA()) {
				if(options.arg == '') {
					options.cmbot.bot.pm("Please specify a user to add.", options.userid);
				} else {
					var user = options.cmbot.getUserByName(options.arg);
					if(user === false) {
						options.cmbot.bot.pm("User not found.", options.userid);
					} else {
						var result = options.cmbot.q.newAddUser(user);
						log("result = " + result);
						if(result.success) {
							options.cmbot.bot.speak(result.queue);
							options.cmbot.checkQueue();
							if(options.cmbot.session.djing) {
								if(options.cmbot.session.autodjing && options.cmbot.currentSong.room.metadata.current_dj != options.cmbot.options.bot.userid && options.cmbot.session.max_djs == options.cmbot.session.djs.length) {
									// The bot is on the decks but isn't playing a song, and the decks are full, so step down.
									log("autodj: someone added to queue and I am autodj'ing so I'm stepping down.");
									options.cmbot.bot.remDj(options.cmbot.options.bot.userid);
								}
							}
							options.cmbot.saveSettings();
						} else {
							if(result.code == options.cmbot.q.USER_ON_DECKS) {
								options.cmbot.bot.pm(user.name + " is DJ'ing!", options.userid);
							} else if(result.code == options.cmbot.q.USER_IN_QUEUE) {
								options.cmbot.bot.pm(user.name + " is number " + result.spot + " in the queue.", options.userid);
							}
						}
					}
				}
			} else {
				options.cmbot.bot.pm(this.options.ffa_text, userid);
			}
		},
		modonly: true,
		pmonly: true
	},
	'warn': {
		command: function(options) {
			if(options.cmbot.currentSong.room.metadata.current_song == undefined) {
				options.cmbot.bot.pm("Nobody is DJ'ing!", options.userid);
			} else if(options.userid == options.cmbot.currentSong.room.metadata.current_song.djid) {
				options.cmbot.bot.pm("You can't warn yourself!", options.userid);
			} else {
				var warnUser = options.cmbot.users[options.cmbot.currentSong.room.metadata.current_song.djid];
				if(options.cmbot.session.warned) {
					options.cmbot.bot.pm("A warning has already been sent to " + warnUser.name + " for this song.", options.userid);
				} else {
					if(!warnUser.djing) {
						options.cmbot.bot.pm(warnUser.name + " is not DJ'ing!", options.userid);
					} else {
						options.cmbot.session.warned = true;
						var text = "your song is does not fall within the established genre of the room or else it's not loading.  Please skip or you will be removed from the decks in 15 seconds.";
						if(options.arg == 'loading')
							text = "your song is not loading. Please skip or you will be removed from the decks in 15 seconds.";
						else if(options.arg == 'genre')
							text = "your song does not fall within the established genre of the room.  Please skip or you will be removed from the decks in 15 seconds.";
						options.cmbot.bot.speak("@" + warnUser.name + ", " + text);
						warnUser.timers.warning = setTimeout(function() {
							options.cmbot.bot.remDj(warnUser.userid);
							options.cmbot.bot.pm("Sorry, you didn't skip in time.", warnUser.userid);
						}, 15*1000);
						options.cmbot.modpm(options.cmbot.users[options.userid].name + " has sent a warning to " + warnUser.name + ".", false, options.userid, true);
						options.cmbot.bot.pm("Warning sent to " + warnUser.name, options.userid);
					}
				}
			}
		},
		modonly: true,
		pmonly: true,
		help: 'Warn a user to skip their song. Use /warn for a generic message, or "/warn loading" or "/warn genre" for a more specific warning. Use /unwarn to cancel.'
	},
	'unwarn': {
		command: function(options) {
			if(options.cmbot.session.warned) {
				var warnUser = options.cmbot.users[options.cmbot.currentSong.room.metadata.current_song.djid];
				clearTimeout(warnUser.timers.warning);
				options.cmbot.modpm(options.cmbot.users[options.userid].name + " has cancelled the warning to " + warnUser.name + ".", false, options.userid);
				options.cmbot.bot.pm("Warning cancelled.", options.userid);
			} else {
				options.cmbot.bot.pm("No warning has been sent for the current song.", options.userid);
			}
		},
		modonly: true,
		pmonly: true,
		help: 'Cancel a warning.'
	},
	'move': {
		command: function(options) {
			if (options.cmbot.isFFA()) {
				options.cmbot.bot.pm(options.cmbot.options.ffa_text, options.userid);
			}
			else {
				if(options.arg.match(/^(.*)\s([0-9]+)$/)) {
					var userToMove = options.cmbot.getUserByName(RegExp.$1);
					var position = RegExp.$2;
					if(userToMove === false) {
						options.cmbot.bot.pm("User not found.", options.userid);
					}
					else if (position <= options.cmbot.q.getQueueLength() && position > 0) {
						var queue = options.cmbot.q.getQueue();
						var oldPosition = -1;
						$(queue).each(function(index, userid){
							var user = options.cmbot.users[userid];
							if(user.userid == userToMove.userid)
								oldPosition = index;
						});
						if (oldPosition > -1) {
							position--; // user will be specifying 1 as first user in queue, but we need 0 to be first 
							options.cmbot.q.moveUser(oldPosition, position);
							options.cmbot.bot.pm(userToMove.name + " moved to position " + (position + 1), options.userid);
						} else {
							options.cmbot.bot.pm(userToMove.name + " is not in the queue!", options.userid);
						}
					}
					else {
						options.cmbot.bot.pm("Invalid position.", userid);
					}
				} else {
					options.cmbot.bot.pm("Invalid syntax. Use /move user 1, for example.", options.userid);
				}
			}
		},
		modonly: true,
		pmonly: true,
		help: 'Rearrange the queue. Usage: /move <username> <position>. <username> should be the name of the user to move. <position> should be an integer - first spot in the queue is 1, second spot is 2, etc.'
	},
	'untrigger': {
		command: function(options) {
			if (options.cmbot.settings.triggers[options.arg] != undefined) {
				delete options.cmbot.settings.triggers[options.arg];
				options.cmbot.saveSettings();
				log(options.cmbot.users[options.userid].name + " removed trigger " + options.arg);
				options.cmbot.bot.pm("Trigger removed.", options.userid);
			} else
				options.cmbot.bot.pm("Trigger not found.", options.userid);
		},
		modonly: true,
		pmonly: true,
		help: 'Remove a trigger.'
	},
	'lame': {
		command: function(options) {
			options.cmbot.bot.vote('down');
			options.cmbot.session.lamed = true;
		},
		modonly: true,
		pmonly: true,
		help: 'I\'ll lame the current song.'
	},
	'awesome': {
		command: function(options) {
			options.cmbot.bot.vote('up');
		},
		modonly: true,
		pmonly: true,
		help: 'I\'ll awesome the current song.'
	},
	'deccount': {
		command: function(options) {
			options.cmbot.bot.pm("This command is deprecated. Please use /setcount instead.", options.userid);
		},
		modonly: true,
		pmonly: true,
		hide: true,
		help: 'Decrease the playcount for a DJ. Use this if their song didn\'t play properly and they had to skip. (Deprecated)'
	},
	'echo': {
		command: function(options) {
			if(options.arg != '')
				options.cmbot.bot.speak(options.arg);
		},
		modonly: true,
		pmonly: true,
		help: 'Make me say something.'
	},
	'modpm': {
		command: function(options) {
			options.cmbot.bot.pm("This command is disabled - just chat to me and I will send what you write to all the mods in the room.", options.userid);
		},
	},
	'dj': {
		command: function(options) {
			options.cmbot.q.prune();
			if (options.cmbot.isFFA()) {
				if($(options.cmbot.session.djs).length < options.cmbot.session.max_djs)
					options.cmbot.bot.addDj();
				else {
					if(options.pm)
						options.cmbot.bot.pm("Sorry, I can't DJ right now, there's no room!", options.userid);
					else
						options.cmbot.bot.speak("Sorry, I can't DJ right now, there's no room.");
				}
			}
			else {
				var qlength = 0;
				$.each(options.cmbot.q.getQueue(), function(index, userid) {
					if(!options.cmbot.users[userid].afk)
						qlength++;
				});
				if(options.cmbot.users[options.cmbot.options.bot.userid].djing) {
					if(options.pm)
						options.cmbot.bot.pm("I'm already DJ'ing!", options.userid);
					else
						options.cmbot.bot.speak("I'm already DJ'ing, " + options.cmbot.users[options.userid].name + "!");
				} else if ((qlength == 0 && $(options.cmbot.session.djs).length < options.cmbot.session.max_djs) || options.cmbot.session.max_djs - $(options.cmbot.session.djs).length > options.cmbot.q.getQueue().length) {
					// Queue is empty AND there is a free spot, or there are more free spots than the length of the queue, so DJ!
//					log("adding dj");
					options.cmbot.bot.addDj(function(result) {
						if(result.success)
							options.cmbot.users[options.cmbot.options.bot.userid].djing = true;
					});
				}
				else {
//					log("queue isn't empty");
					// Queue is not empty, or else there are not enough free DJ spots, so add the bot to the queue.
					var result = options.cmbot.q.newAddUser(options.cmbot.options.bot.userid);
					if(!result.success) {
						if(result.code == options.cmbot.q.USER_IN_QUEUE) {
							if(options.pm)
								options.cmbot.bot.pm("I am number " + result.spot + " in the queue.", options.userid);
							else
								options.cmbot.bot.speak("I am number " + result.spot + " in the queue.");
						} else if(result.code == options.cmbot.q.USER_ON_DECKS) {
							if(options.pm)
								options.cmbot.bot.pm("I'm already DJ'ing!", options.userid);
							else
								options.cmbot.bot.speak("I'm already DJ'ing, " + options.cmbot.users[options.userid].name + "!");
						}
					} else {
						options.cmbot.bot.speak(result.queue);
					}
				}
			}
		},
		modonly: true,
		pmonly: false,
		help: 'Make me DJ!'
	},
	'yoink': {
		command: function(options) {
			if(options.cmbot.currentSong.room.metadata.current_song == undefined) {
				var text = "Nobody's DJ'ing right now!";
				if(options.pm)
					options.cmbot.bot.pm(text, options.userid);
				else
					options.cmbot.speak(text);
				return false;
			}
			options.cmbot.yoinkTrack(function(result){
				var text;
				if(result.success) {
					text = 'Mine!!';
				} else if(result.error == options.cmbot.q.ALREADY_YOINKED)
					text = "I've already yoinked this one!";
				else
					text = result.error;
				if(options.pm)
					options.cmbot.bot.pm(text, options.userid);
				else
					options.cmbot.bot.speak(text);
			});
		},
		modonly: true,
		pmonly: false,
		help: 'I will \'love\' the currently playing song on last.fm, and also add the song to my queue.'
	},
	'fanme': {
		command: function(options) {
			options.cmbot.bot.becomeFan(options.userid, function(result) {
				if(options.pm)
					options.cmbot.bot.pm('Wawaweewa', options.userid);
				else
					options.cmbot.bot.speak(":heart: I love " + options.cmbot.users[options.userid].name + " long time. :heart:");
			});
		},
		modonly: false,
		pmonly: false,
		help: 'I\'ll love you long time!'
	},
	'playcount': {
		command: function(options) {
			if(options.cmbot.currentSong.room.metadata.current_song == undefined) {
				var text = "Nobody's DJ'ing right now!";
				if(options.pm)
					options.cmbot.bot.pm(text, options.userid);
				else
					options.cmbot.speak(text);
				return false;
			}
			var counts = options.cmbot.getPlayCounts();
//			log("counts: ", counts);
			if(options.pm)
				options.cmbot.bot.pm(counts.join(', '), options.userid);
			else
				options.cmbot.bot.speak(counts.join(', '));
		},
		modonly: false,
		pmonly: false,
		help: 'Show how many songs each DJ currently on the decks has played.'
	},
	'ban': {
		command: function(options) {
			var found = false;
			var foundArtist = '';
			$.each(options.cmbot.settings.bannedArtists, function(key, val) {
				if(key.toLowerCase() == arg.toLowerCase()) {
					found = true;
					foundArtist = key;
				}
			});
			var text;
			if(found) {
				text = foundArtist + " is already banned.";
			} else {
				options.cmbot.settings.bannedArtists[arg] = 1;
				log("banned artists now ", options.cmbot.settings.bannedArtists);
				options.cmbot.saveSettings();
				text = options.arg + " is now banned.";
			}
			if(options.pm)
				options.cmbot.bot.pm(text, options.userid);
			else
				options.cmbot.bot.speak(text);
		},
		modonly: true,
		pmonly: false,
		help: 'Ban an artist by name. Case insensitive.'
	},
	'unban': {
		command: function(options) {
			var found = false;
			var foundArtist = '';
			$.each(options.cmbot.settings.bannedArtists, function(key, val) {
				if(key.toLowerCase() == arg.toLowerCase()) {
					delete options.cmbot.settings.bannedArtists[key];
					log("banned artists now ", options.cmbot.settings.bannedArtists);
					options.cmbot.saveSettings();
					found = true;
					foundArtist = key;
				}
			});
			var text;
			if(found) {
				text = foundArtist + " is now unbanned.";
			} else {
				text = arg + " is not banned.";
			}
			if(options.pm)
				options.cmbot.bot.pm(text, options.userid);
			else
				options.cmbot.bot.speak(text);
		},
		modonly: true,
		pmonly: false,
		help: 'Unban an artist by name. Case insensitive.'
	},
	'enforcement': {
		command: function(options) {
			var text;
			if(options.arg == '') {
				text = "Enforcement is " + (options.cmbot.session.enforcement ? 'on' : 'off') + ".";
			} else if(options.arg == 'on') {
				options.cmbot.session.enforcement = true;
				text = "Enforcement is now on.";
			} else if(options.arg == 'off') {
				options.cmbot.session.enforcement = false;
				text = "Enforcement is now off.";
			} else {
				text = "Usage: /enforcement [on|off]";
			}
			if(options.pm)
				options.cmbot.bot.pm(text, options.userid);
			else
				options.cmbot.bot.speak(text);
		},
		modonly: true,
		pmonly: false,
		help: 'Turn queue enforcement on or off. If it\'s off, I won\'t escort a DJ off the deck if they get on the deck when it isnt\'t their turn.'
	},
	'refresh': {
		command: function(options) {
			var text = '';
			try {
				var user = options.cmbot.users[options.userid];
				if (user.djing) {
					options.cmbot.session.refreshes.push(user.userid);
					options.cmbot.users[user.userid].refresh = true;
					text = (options.pm ? "Y" : user.name + ", y") + "ou can refresh now without losing your spot.";
					user.timers.removeRefresh = setTimeout(function() {
						user.refresh = false;
						options.cmbot.session.refreshes.splice(options.cmbot.session.refreshes.indexOf(user.userid));
						if(!user.present)
							options.cmbot.bot.speak(user.name + " hasn't returned in time. Cancelling refresh.");
						else if(!user.djing)
							options.cmbot.bot.pm(user.name + ", you didn't step back up in time! Sorry, you lost your spot.", user.userid, function(result) {
								if(!result.success)
									options.cmbot.bot.speak(user.name + ", you didn't step back up in time! Sorry, you lost your spot.");
							});
						else
							options.cmbot.bot.pm(user.name + ", you waited too long to refresh. Type /refresh if you still need to refresh your browser (if you don't, and step down, you'll lose your spot).", user.userid, function(result) {
								if(!result.success)
									options.cmbot.bot.speak(user.name + ", you waited too long to refresh. Type /refresh if you still need to refresh your browser (if you don't, and step down, you'll lose your spot).");
							});
					}, 3*60*1000);
				} else {
					text = "You're not dj'ing" + (options.pm ? "!" : ", " + user.name + "!");
				}
				if(options.pm)
					options.cmbot.bot.pm(text, options.userid);
				else
					options.cmbot.bot.speak(text);
			} catch(e) {
				log("Exception refreshing: ", e);
			}
		},
		modonly: false,
		pmonly: false,
		help: 'If you need to refresh your browser (like if the music isn\'t playing), type /refresh and I\'ll save your place. Otherwise, if you tried to step up and someone else is in the queue, I\'ll escort you down.'
	},
	'escortme': {
		command: function(options) {
			var user = options.cmbot.users[options.userid];
			var text = '';
			if (user.djing) {
				if (!user.escortme) {
					user.escortme = true;
					text = user.name + ", I'll take you down after your next track.";
				}
				else {
					user.escortme = false;
					text = user.name + ", I won't take you down after your next track.";
				}
			} else {
				text = "You're not dj'ing right now, " + user.name + "! Silly human.";
			}
			if(options.pm)
				options.cmbot.bot.pm(text, options.userid);
			else
				options.cmbot.bot.speak(text);
		},
		modonly: false,
		pmonly: false,
		help: 'Use this if you are going to be AFK and want me to take you off the decks after your next song.'
	},
	'votes': {
		command: function(options) {
			var upvotes = [];
			var downvotes = [];
			$.each(options.cmbot.session.votes.up, function(index, userid) {
				var user = options.cmbot.users[userid];
				var name = user != undefined ? user.name : "(Unknown)";
				upvotes.push(name);
			});
			$.each(options.cmbot.session.votes.down, function(index, userid) {
				var user = options.cmbot.users[userid];
				var name = user != undefined ? user.name : "(Unknown)";
				downvotes.push(name);
			});
			var text = (upvotes.length > 0 ? "Awesomes: " + upvotes.join(', ') + (downvotes.length > 0 ? "; " : "") : "") + (downvotes.length > 0 ? "Lames: " + downvotes.join(', ') : "");
			if(text == '')
				text = "No votes for this song yet.";
			options.cmbot.bot.pm(text, options.userid);
			log("Votes: ", options.cmbot.session.votes);
		},
		modonly: true,
		pmonly: true,
		help: '',
		hide: true
	},
	'back': {
		command: function(options) {
			if(options.arg != '') {
				if(!options.cmbot.users[options.userid].mod) {
					if(options.pm)
						options.cmbot.bot.pm("I'm sorry, Dave. I'm afraid I can't do that.", options.userid);
					else
						options.cmbot.bot.speak("I'm sorry, Dave. I'm afraid I can't do that.");
				} else {
					var user = options.cmbot.getUserByName(options.arg);
					if(user === false) {
						if(options.pm)
							options.cmbot.bot.pm("User " + options.arg + " not found.", options.userid);
						else
							options.cmbot.bot.speak("User " + options.arg + " not found.");
					} else {
						user.afk = false;
						var text = user.name + " is back.";
						if(options.pm)
							options.cmbot.bot.pm(text, options.userid);
						else
							options.cmbot.bot.speak(text);
					}
				}
			} else {
				options.cmbot.users[options.userid].afk = false;
				if(options.pm)
					options.cmbot.bot.pm("You are back.", options.userid);
				else
					options.cmbot.bot.speak(options.cmbot.users[options.userid].name + " is back.");
			}
		},
		modonly: false,
		pmonly: false,
		help: ''
	},
	'afk': {
		command: function(options) {
			if(options.arg != '') {
				if(!options.cmbot.users[options.userid].mod) {
					if(options.pm)
						options.cmbot.bot.pm("I'm sorry, Dave. I'm afraid I can't do that.", options.userid);
					else
						options.cmbot.bot.speak("I'm sorry, Dave. I'm afraid I can't do that.");
				} else {
					var user = options.cmbot.getUserByName(options.arg);
					if(user === false) {
						if(options.pm)
							options.cmbot.bot.pm("User " + options.arg + " not found.", options.userid);
						else
							options.cmbot.bot.speak("User " + options.arg + " not found.");
					} else {
						user.afk = true;
						clearTimeout(user.timers.queueTimer);
						var text = user.name + " is away.";
						if(options.pm)
							options.cmbot.bot.pm(text, options.userid);
						else
							options.cmbot.bot.speak(text);
						options.cmbot.checkQueue();
					}
				}
			} else {
				options.cmbot.users[options.userid].afk = true;
				clearTimeout(options.cmbot.users[options.userid].timers.queueTimer);
				if(options.pm)
					options.cmbot.bot.pm("You are away.", options.userid);
				else
					options.cmbot.bot.speak(options.cmbot.users[options.userid].name + " is away.");
				options.cmbot.checkQueue();
				
			}
		},
		modonly: false,
		pmonly: false,
		help: 'Mark yourself as afk. When someone steps off the decks, I will alert the first non-afk DJ in the queue that it\'s their turn. Mods can pass a user\'s name to mark that person away.'
	},
	'shows': {
		command: function(options) {
//			if(options.pm)
//				return false;
			try {
				var artist = options.arg || options.cmbot.currentSong.room.metadata.current_song.metadata.artist;
				var httpoptions = {
					url: 'http://api.songkick.com/api/3.0/search/artists.json?query=' + encodeURIComponent(artist) + '&apikey=' + options.cmbot.options.songkick.api_key
				};
				myhttp.get(httpoptions, function(error, getresult) {
					var artist_result = JSON.parse(getresult.buffer);
					log("artist result: " + artist_result);
					if(artist_result.resultsPage.totalEntries == 0) {
						//bot.speak("Artist not found.");
						log("Artist not found.");
					} else {
						var artist_id = artist_result.resultsPage.results.artist[0].id;
						myhttp.get({url: 'http://api.songkick.com/api/3.0/artists/' + artist_id + '/calendar.json?apikey=' + options.cmbot.options.songkick.api_key}, function(error, calendarresult) {
							var result = JSON.parse(calendarresult.buffer);
							if(result.resultsPage.totalEntries == 0) {
								log("No shows found for " + artist_result.resultsPage.results.artist[0].displayName);
								options.cmbot.bot.speak("No shows found for " + artist_result.resultsPage.results.artist[0].displayName + '.');
							} else {
								var shows = [];
								$.each(result.resultsPage.results.event, function(index, event) {
									if(index <= 6)
										shows.push(event.venue.metroArea.displayName + ' ' + dateFormat(new Date(event.start.date), 'm/d'));
								});
								log("shows: ", shows);
								options.cmbot.shortenUrl(artist_result.resultsPage.results.artist[0].uri, function(res) {
									if(res.success) {
										log("Shows for " + artist_result.resultsPage.results.artist[0].displayName + ': ' + shows.join(', ') + ' ' + res.url);
										options.cmbot.bot.speak("Shows for " + artist_result.resultsPage.results.artist[0].displayName + ': ' + shows.join(', ') + ' ' + res.url);
									}
								});
							}
						});
					}
				});
			} catch(e) {
				log("Exception getting shows: ", e);
			}
		},
		modonly: false,
		pmonly: false,
		help: 'Look up (on songkick.com) upcoming shows by a particular artist. I\'ll only show up to 7 shows. Usage: /shows bonobo'
	},
	'bannedartists': {
		command: function(options) {
			var a = [];
			$.each(options.cmbot.settings.bannedArtists, function(artist, one) {
				a.push(artist);
			});
			var text;
			if(a.length == 0)
				text = "There are no banned artists";
			else
				text = "Banned Artists (" + a.length + "): " + a.join(', ');
			if(options.pm)
				options.cmbot.bot.pm(text, options.userid);
			else
				options.cmbot.bot.speak(text);
		},
		modonly: false,
		pmonly: false,
		hide: true
	},
	'djafk': {
		command: function(options) {
			var counts = [];
			$(options.cmbot.session.djs).each(function(index, userid) {
				try {
					var user = options.cmbot.users[userid];
					var diff = Math.floor(((new Date().getTime() - user.lastInteraction) / 1000) / 60);
					log("diff for " + user.name + " = " + diff);
					if(diff > 0)
						counts.push(user.name + ": " + diff + ' mins.');
				} catch(e) {
				}
			});
			var text;
			if(counts.length > 0)
				text = "AFK Djs: " + counts.join(', ');
			else
				text = "No DJ's are AFK.";
			if(options.pm)
				options.cmbot.bot.pm(text, options.userid);
			else
				options.cmbot.bot.speak(text);

		},
		modonly: false,
		pmonly: false,
		help: 'Show how long each DJ has been afk. Saying something in the room or voting will reset your AFK timer. If your AFK time is less than one minute, I won\'t display your name here.'
	},
	'triggerlimit': {
		command: function(options) {
			if(options.arg.match(/^(.*) ([0-9]+)$/)) {
				var trigger = RegExp.$1;
				var timeLimit = RegExp.$2;
				if (options.cmbot.settings.triggers[trigger] == undefined) {
					options.cmbot.bot.pm("That trigger doesn't exist.", options.userid);
				} else {
					if (timeLimit == 0) {
						delete options.cmbot.settings.triggerLimit[trigger];
						options.cmbot.bot.pm("Trigger limit for /" + trigger + " removed.", options.userid);
					} else {
						options.cmbot.settings.triggerLimit[trigger] = timeLimit;
						options.cmbot.bot.pm("Time limit between usages of /" + trigger + " set to " + timeLimit + " seconds.", options.userid);
					}
					options.cmbot.saveSettings();
				}
			} else {
				options.cmbot.bot.pm("Usage: /triggerlimit <trigger> <# of seconds>", options.userid);
			}
		},
		modonly: true,
		pmonly: true,
		help: 'Set the amount of time (in seconds) that I will ignore a particular trigger once it has been said. Use a value of 0 to remove the time limit for the trigger.'
	},
	'triggerban': {
		command: function(options) {
			if(options.arg == '') {
				options.cmbot.bot.pm("Usage: /triggerban <username>", options.userid);
				return false;
			}
			var user = options.cmbot.getUserByName(options.arg);
			var text;
			if(user == false) {
				text = arg + " not found.";
			} else if(options.cmbot.settings.triggerBan[user.userid] != undefined) {
				log("ban exists");
				var banExpireDate = new Date(options.cmbot.settings.triggerBan[user.userid]);
				text = "Trigger ban for " + user.name + " expires " + banExpireDate.toDateString() + " " + banExpireDate.toTimeString();
			} else {
				options.cmbot.settings.triggerBan[user.userid] = options.now() + (60*60*24*1000); // this is when this ban expires
				text = user.name + " is banned from using triggers for the next 24 hours.";
			}
			options.cmbot.bot.pm(text, options.userid);
			log("triggerbans: ", options.cmbot.settings.triggerBan);
			options.cmbot.saveSettings();

		},
		modonly: true,
		pmonly: true,
		help: 'Ban a user from using triggers for 24 hours.'
	},
	'kick': {
		command: function(options) {
			if(options.arg == '') {
				if(options.pm)
					options.cmbot.bot.pm("Please specify a user to kick!", options.userid);
				else
					options.cmbot.bot.speak("Please specify a user to kick!");
			} else {
				var user = options.cmbot.getUserByName(arg);
				if(user === false) {
					if(options.pm)
						options.cmbot.bot.pm("User not found.", options.userid);
					else
						options.cmbot.bot.speak("User not found.");
				} else if(user.userid != options.cmbot.options.bot.userid)
					options.cmbot.bot.bootUser(user.userid, arg != '' ? arg : '');
			}
		},
		modonly: true,
		pmonly: false,
		help: 'Kick a user from the room. Usage: /kick [reason]'
	},
	'uptime': {
		command: function(options) {
			var uptime = options.cmbot.getUptime();
			if(options.pm)
				options.cmbot.bot.pm(uptime, options.userid);
			else
				options.cmbot.bot.speak(uptime);
		},
		modonly: false,
		pmonly: false,
		help: ''
	},
	'skip': {
		command: function(options) {
			if(options.cmbot.users[options.cmbot.options.bot.userid].djing)
				options.cmbot.bot.stopSong();
			else
				options.cmbot.bot.speak("Please skip this track.");
		},
		modonly: true,
		pmonly: true,
		help: ''
	},
	'autodj': {
		command: function(options) {
			var text = '';
			if(options.arg == '')
				text = "AutoDJ is " + (options.cmbot.session.autodj ? 'on' : 'off');
			else if(options.arg == 'on') {
				if(options.cmbot.session.autodj)
					text = 'AutoDJ is already on.';
				else {
					options.cmbot.session.autodj = true;
					text = 'AutoDJ is now on.';
					options.cmbot.autodj();
				}
			} else if(options.arg == 'off') {
				if(!options.cmbot.session.autodj)
					text = 'AutoDJ is already off.';
				else {
					options.cmbot.session.autodj = false;
					clearTimeout(options.cmbot.session.timers.autodj);
					options.cmbot.session.timers.autodj = false;
					text = 'AutoDJ is now off.';
				}
			} else {
				text = "Usage: /autodj [on|off]";
			}
			options.cmbot.bot.pm(text, options.userid);
		},
		modonly: true,
		pmonly: true,
		help: 'Set autodj on or off. Usage: /autodj [on|off]'
	},
	'stfu': {
		command: function(options) {
			if(options.cmbot.options.messages.length == 0) {
				if(options.pm)
					options.cmbot.bot.pm("I don't have any messages to say!", options.userid);
				else
					options.cmbot.bot.speak("I don't have any messages to say!", options.userid);
			}
			if(!options.cmbot.session.stfu) {
				options.cmbot.session.stfu = true;
				var interval = options.cmbot.options.messages.length * options.cmbot.options.messages.message_interval;
				setTimeout(function() {
					options.cmbot.session.stfu = false;
				}, interval*60*1000);
				var text = 'It\'s true, I do talk too much, sorry about that.';
				if(options.pm)
					options.cmbot.bot.pm(text, options.userid);
				else
					options.cmbot.bot.speak(text);
			}
		},
		modonly: true,
		pmonly: false,
		help: 'Prevent the bot from saying informational messages for 30 minutes.'
	},
	'tweet': {
		command: function(options) {
			if(options.cmbot.twit !== false) {
				options.cmbot.twit.updateStatus(options.cmbot.users[options.userid].name + ': ' + options.arg,
					function (err, data) {
					options.cmbot.bot.pm("Tweeted, you twit.", options.userid);
					}
				);
			} else {
				options.cmbot.options.pm("Twitter access not properly set up, sorry.", options.userid);
			}
		},
		modonly: true,
		pmonly: true,
		hide: true
	},
	'profile': {
		command: function(options) {
			var pr = options.arg.split(' ', 1);
			var ar = options.arg.substring(options.arg.indexOf(' '));
			var props = [pr, ar];
			var profile = {website: ''};
			props[1] = props[1].replace("\\n", "\n");
			profile[props[0]] = props[1];
			log("profile: ", profile);
			options.cmbot.bot.modifyProfile(profile, function(result) {
				var text;
				if(result.success)
					text = "Profile updated.";
				else
					text = result.error;
				options.cmbot.bot.pm(text, options.userid);
			});
		},
		modonly: true,
		pmonly: true,
		hide: true,
		acl: true
	},
	'help': {
		command: function(options) {
			var text;
			if(options.arg != '') {
				if(typeof options.cmbot.commands[options.arg] != 'object') {
					text = "Sorry, I don't know that command.";
				} else if(options.cmbot.commands[options.arg].help == '') {
					text = "Sorry, I don't have any info on that command.";
				} else {
					text = options.arg + ": " + options.cmbot.commands[options.arg].help + (options.cmbot.commands[options.arg].pmonly ? " (PM Only)" : "") + (options.cmbot.commands[options.arg].modonly ? " (Mod Only)" : "");
				}
			} else {
				var commands = [];
				$.each(options.cmbot.commands, function(commandName, command) {
					var addCommand = false;
					if(!command.modonly)
						addCommand = true;
					if(command.modonly && options.cmbot.users[options.userid].mod && options.pm)
						addCommand = true;
					if(options.cmbot.settings.acl[commandName] != undefined) {
						if(!options.cmbot.settings.acl[commandName][options.userid])
							addCommand = false;
					}
					if(options.cmbot.options.master_userid == options.userid && options.pm)
						addCommand = true;
					if(command.hide !== true && addCommand)
						commands.push('/' + commandName);
				});
				commands.sort();
				text = "Commands: " + commands.join(', ') + ". You can also get command specific help by typing '/help command' (ie, /help queue).";
			}
			if(options.pm)
				options.cmbot.bot.pm(text, options.userid);
			else
				options.cmbot.bot.speak(text);
			
		},
		modonly: false,
		pmonly: false,
		hide: true
	},
};

cmbot.prototype.activateIdleDJCheck = function(user) {
	var cmbot = this;
	if(!cmbot.session.enforcement || cmbot.session.battlemode)
		return false;
	clearTimeout(user.timers.idleDJCheck);
	user.timers.idleDJCheck = setTimeout(function() {
		// First, make sure this user is dj'ing
		if (user.djing) {
			if (cmbot.currentSong.room.metadata.current_dj == user.userid) {
				cmbot.bot.pm('@' + user.name + ', you have until the end of this song to chat or vote before being taken down from the decks. (' + cmbot.settings.idleDJTimeout + ' minute idle limit)', user.userid);
				user.idleDJEscort = true;
			}
			else {
				cmbot.bot.pm('@' + user.name + ', you have one minute to chat or vote before being taken down from the decks. (' + cmbot.settings.idleDJTimeout + ' minute idle limit)', user.userid);
				user.timers.idleDJRemove = setTimeout(function(){
					//				log("Removing idle dj " + user.name + " who has been idle for " + diff + " minutes.");
					if(cmbot.session.current_dj != user.userid)
						cmbot.bot.remDj(user.userid);
					else {
						//session.songstarted = timestamp in ms of when the song started
						// a should be number of seconds until
						// currentSong.room.metadata.current_song.metadata.length * 1000
						user.timers.idleDJRemove = setTimeout(function() {
							cmbot.bot.remDj(user.userid);
						}, (cmbot.currentSong.room.metadata.current_song.metadata.length * 1000) - (now() - cmbot.session.songstarted));
					}
				}, 60 * 1000);
			}
		//			log('@' + user.name + ', you have one minute to chat or vote before being taken down from the decks.');
		}
		else {
			clearTimeout(user.timers.idleDJCheck);
			user.timers.idleDJCheck = false;
		}
	}, cmbot.settings.idleDJTimeout*60*1000);
};

Date.prototype.stdTimezoneOffset = function() {
	var jan = new Date(this.getFullYear(), 0, 1);
	var jul = new Date(this.getFullYear(), 6, 1);
	return Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
};

function log() {
	var string = arguments[0];
	var date = new Date();
	var month = date.getMonth() + 1;
	if(month < 10)
		month = "0" + month;
	var minutes = date.getMinutes();
	if(minutes < 10)
		minutes = "0" + minutes;
	var seconds = date.getSeconds();
	if(seconds < 10)
		seconds = "0" + seconds;
	string = "[" + date.getFullYear() + "-" + month + "-" + date.getDate() + " " + 
		date.getHours() + ":" + minutes + ":" + seconds + "] " + string;
	if(arguments[1] != undefined) {
		console.log(string, arguments[1]);
	} else {
		console.log(string);
	}
}

module.exports = cmbot;

