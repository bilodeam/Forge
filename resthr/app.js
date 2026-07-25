import * as session from './utils/session'

/*
 * App entry point.
 *
 * onCreate receives the `param` string we attached to the @zos/alarm that backs
 * the rest countdown. When the watch was asleep and the alarm relaunches us,
 * this is where we land -- we don't need to do anything clever with it because
 * session.restore() rebuilds the workout from wall-clock timestamps on disk.
 * We stash it on globalData anyway so pages can inspect it while debugging.
 */
App({
  globalData: {
    launchParams: null,
  },

  onCreate(params) {
    this.globalData.launchParams = params || null
    session.restore()
  },

  onDestroy() {
    // Persist whatever we have so an unexpected kill doesn't lose the session.
    session.persist()
  },
})
