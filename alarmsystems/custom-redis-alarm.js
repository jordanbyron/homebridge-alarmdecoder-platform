var alarms = require("./base.js");
var debug = require("debug");
var redis = require("redis");
const client = redis.createClient();
const { promisify } = require("util");
const getAsync = promisify(client.get).bind(client);
const publishAsync = promisify(client.publish).bind(client);

class CustomRedisAlarm extends alarms.AlarmBase {
  constructor(log, config) {
    super(log);
    this.key = config.key;
    this.setPIN = config.setPIN;
    this.panicKey = config.panicKey;
    this.chimeKey = config.chimeKey;
  }

  async initZones() {
    try {
      this.log("init zones");
      const response = await getAsync("alarm/cache");
      const json = JSON.parse(response);
      for (let zoneId in json.zones) {
        let zone = json.zones[zoneId];
        this.alarmZones.push(
          new alarms.AlarmZone(zoneId, zone.name, zone.name)
        );
      }
      return true;
    } catch (e) {
      this.log(e);
      return false;
    }
  }

  async getAlarmState(state) {
    try {
      if (state === undefined) {
        const response = await getAsync("alarm/cache");
        state = JSON.parse(response);
      }
      if (state) {
        let stateObj = state;

        /* 0 = stay, 1 = away, 2 = night, 3 = disarmed, 4 = alarm */
        this.log(JSON.stringify(state));
        if (stateObj.alarm_sounding || stateObj.fire || stateObj.panic) {
          this.state = 4;
        } else if (stateObj.armed_home && stateObj.perimeter_only) {
          this.state = 2;
        } else if (stateObj.armed_home) {
          this.state = 0;
        } else if (stateObj.armed_away) {
          this.state = 1;
        } else this.state = 3;

        // use state object to update zones
        for (let alarmZone in this.alarmZones) {
          alarmZone = this.alarmZones[alarmZone];
          if (stateObj.zones[alarmZone.zoneID].issue) alarmZone.faulted = true;
          else alarmZone.faulted = false;
        }
        return true;
      } else throw "getAlarmState failed";
    } catch (e) {
      this.log(e);
      return false;
    }
  }

  /* 0 = stay, 1 = away, 2 = night, 3 = disarmed, 4 = alarm */
  async setAlarmState(state) {
    var codeToSend = null;
    switch (state) {
      case 0: //stay|home
        codeToSend = this.setPIN + "3";
        break;
      case 1:
        codeToSend = this.setPIN + "2";
        break;
      case 2:
        codeToSend = this.setPIN + "33";
        break;
      case 3:
        codeToSend = this.setPIN + "1";
        break;
      case 4:
        codeToSend = this.panicKey;
        state = true;
        break;
      case "chime":
        codeToSend = this.setPIN + this.chimeKey;
        state = true;
        break;
    }
    try {
      // ignore disarm requests if panel is already disarmed and it's a DSC panel (otherwise it rearms itself)
      if (this.isDSC && state == 3 && this.state == 3) {
        debug(
          "disarm request for DSC panel but system is already disarmed, ignoring"
        );
        return true;
      }
      var response = await publishAsync("alarm_decoder_write", codeToSend);
      return true;
    } catch (err) {
      this.log(err);
      return false;
    }
  }
}

module.exports.CustomRedisAlarm = CustomRedisAlarm;
