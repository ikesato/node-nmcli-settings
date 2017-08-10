const childp = require('child_process');
const sudo = require('./sudo');
let sudopass = '';

exports.sudopass = sudopass;

/**
 * Usage:
 *   if (installedNmcli()) {
 *     console.log('Yes, nmcli installed.');
 *   }
 */
exports.installedNmcli = function() {
	try {
		childp.execSync('nmcli d');
		return true;
	} catch(e) {
		return false;
	}
}

/**
 * Usage:
 *   listDevices((err, devices) => {
 *     if (err) return;
 *     console.log('Number of devices : ' + devices.length);
 *     for (const d of devices) {
 *       console.log('NAME  : ' + d.name);
 *       console.log('TYPE  : ' + d.type); // ethernet or wifi or loopback
 *       console.log('STATE : ' + d.state); // connected or disconnected or unmanaged
 *     }
 *   });
 */
exports.listDevices = function(callback) {
	const cmd = 'nmcli -f DEVICE,TYPE,STATE device';
	childp.exec(cmd, {env: {LANG: 'C'}}, (err, stdout, stderr) => {
		if (err) {
			callback(new Error('Cannot list devices'), null);
			return;
		}
		const ret = [];
		const lines = stdout.split("\n");
		lines.shift();
		for (const line of lines) {
			const sp = line.trim().split(/\s+/);
			if (sp.length < 3)
				continue;
			const dev = {
				name: sp[0],
				type: sp[1],
				state: sp[2]
			};
			ret.push(dev);
		}
		callback(null, ret);
	});
}

/**
 * Usage:
 *   scanWiFi((err, aplist) => {
 *     if (err) return;
 *     console.log('Number of APs : ' + aplist.length);
 *     for (const ap of aplist) {
 *       console.log('SSID     : ' + ap.ssid);
 *       console.log('BSSID    : ' + ap.bssid);
 *       console.log('MODE     : ' + ap.mode); // 'Infra' or 'Ad-Hoc'
 *       console.log('CHANNEL  : ' + ap.channel);
 *       console.log('SIGNAL   : ' + ap.signal);
 *       console.log('ACTIVE   : ' + ap.active); // true or false
 *       console.log('SECURITY : ' + ap.security); // string array, ie. ['WPA1', 'WPA2']
 *     }
 *   });
 */
exports.scanWiFi = function(callback) {
	const cmd = 'nmcli -f SSID,MODE,BSSID,ACTIVE,CHAN,SIGNAL,SECURITY device wifi list';
	childp.exec(cmd, {env: {LANG: 'C'}}, (err, stdout, stderr) => {
		if (err) {
			const msg = 'Cannot scan Wifi APs';
			callback(new Error(msg), null);
			return;
		}
		const ret = [];
		const lines = stdout.split("\n");
		lines.shift();
		for (const line of lines) {
			let li = line.indexOf('Infra');
			if (li == -1) li = line.indexOf('Ad-Hoc');
			if (li == -1) continue;
            let ssid = line.slice(0,li).trim();
			if (ssid === '--')
				ssid = '';
			const sp = line.slice(li).trim().split(/\s+/);
			if (sp.length < 6)
				continue;
			const ap = {
				ssid: ssid,
				mode: sp[0],
				bssid: sp[1],
				active: (sp[2] === 'yes'),
				channel: parseInt(sp[3]),
				signal: parseInt(sp[4]),
				security: sp.slice(5),
			}
			if (ap.security[0] === '--')
				ap.security = [];
			ret.push(ap);
		}
		callback(null, ret);
	});
}


/**
 * Usage:
 *   nmcli.deleteConnection('picogw_conn', (err)=>{
 *     console.log('success');
 *   });
 */
exports.deleteConnection = function(conname, callback) {
	const commands = [];
	commands.push(['nmcli', 'connection', 'delete', conname]);
	executeCommands(commands, callback);
}

/**
 * Usage:
 *   nmcli.setConnection('picogw_conn', 'wlan0', {ssid: '000kx', password: 'password'}, (err)=>{
 *     console.log('success');
 *   });
 */
exports.setConnection = function(conname, ifname, ...args) {
	const callback = args.pop();
	const arg = args.pop() || {};
	let commands = [];
	commands.push(['-', 'nmcli', 'connection', 'down', conname]);
	commands.push(['-', 'nmcli', 'connection', 'delete', conname]);
	const isWiFi = !!arg.ssid;
	if (isWiFi) {
		commands.push(['nmcli', 'connection', 'add', 'con-name', conname,
					   'type', 'wifi', 'ifname', ifname, 'ssid', arg.ssid]);
	} else {
		commands.push(['nmcli', 'connection', 'add', 'con-name', conname,
					   'type', 'ethernet', 'ifname', ifname]) ;
	}

	if (!arg.static || !arg.static.ip) { // DHCP
		commands.push(['nmcli', 'connection', 'modify', conname,
					   'ipv4.method', 'auto']) ;
	} else { // static ip
		let ipSetting = arg.static.ip;
		if (arg.static.gateway)
			ipSettings += ' ' + arg.static.gateway;
		commands.push(['nmcli', 'connection', 'modify', conname,
					   'ipv4.method', 'manual', 'ipv4.addresses', ipSettings]);
	}

	if (isWiFi) {
		commands.push(['nmcli', 'connection', 'modify', conname,
					   'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', arg.password]);
	}
	//commands.push(['nmcli', 'connection', 'down', conname]) ;
	commands.push(['nmcli', 'connection', 'up', conname]) ;

	executeCommands(commands, callback);
}


function executeCommands(commands, callback) {
	const opt = {spawnOptions: {LANG: 'C'}};
	if (sudopass)
		opt.password = sudopass;

	function ex() {
		const cmd = commands.shift()
		if (!cmd || cmd.length == 0) {
			callback(null);
			return;
		}
		console.log("aaaaaaa", cmd.join(' '));
		let ignoreError = false;
		if (cmd[0] === '-') {
			cmd.shift();
			ignoreError = true;
		}
		const child = sudo(cmd, opt);
		child.stderr.on('data', dat => {
			if (ignoreError)
				return;
			const msg = 'Error in executing\n\n$ ' + cmd.join(' ') + '\n\n' + dat.toString();
			//console.error(msg);
			callback(new Error(msg));
			commands = [];
		});
		child.stdout.on('close', () => {
			ex();
		});
	}
	ex();
}
