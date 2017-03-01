import checkVersion from 'botpress-version-manager'

import path from 'path'
import fs from 'fs'
import _ from 'lodash'

import db from './db'

let subscriptions = null
let cached_config = null

const incomingMiddleware = bp => (event, next) => {
  if (!subscriptions || !cached_config) { 
    return next()
  }

  const categoriesText = subscriptions.map(s => s.category.toUpperCase()).join(', ')
  
  const executeAction = (type, action) => {
    if (type === 'text') {
      const txt = action.replace(/{{categories}}/ig, categoriesText)

      bp.middlewares.sendOutgoing({
        platform: event.platform,
        type: 'text',
        text: txt,
        raw: {
          to: event.user && event.user.id,
          message: txt
        }
      })
    } else {
      let fn = new Function('bp', 'event', 'userId', 'platform', action)
      fn(bp, event, event.user.id, event.platform)
    }
  }

  if (cached_config && _.includes(cached_config.manage_keywords, event.text)) {
    return executeAction(cached_config.manage_type, cached_config.manage_action)
  }

  if (subscriptions) {
    let exit = false
    subscriptions.forEach(sub => {
      if (_.includes(sub.sub_keywords, event.text)) {
        exit = true
        db(bp).subscribe(event.platform + ':' + event.user.id, sub.category)
        .then(() => {
          executeAction(sub.sub_action_type, sub.sub_action)
        })
        .catch(next)
      }

      if (_.includes(sub.unsub_keywords, event.text)) {
        exit = true
        db(bp).unsubscribe(event.platform + ':' + event.user.id, sub.category)
        .then(() => {
          executeAction(sub.unsub_action_type, sub.unsub_action) 
        })
        .catch(next)
      }
    })
    if (exit) {
      return
    }
  }

  next()
}

module.exports = {

  config: { 
    manage_keywords: { type: 'any', required: true, default: ['MANAGE_SUBSCRIPTIONS'], validation: v => _.isArray(v) },
    manage_action: { type: 'string', required: true, default: 'To unsubscribe, type: UNSUBSCRIBE_<CATEGORY>. Categories are: {{categories}}', },
    manage_type: { type: 'choice', required:true, default: 'text', validation: ['text', 'javascript'] }
  },

  init: function(bp, config) {
    checkVersion(bp, __dirname)

    bp.middlewares.register({
      name: 'manage.subscriptions',
      type: 'incoming',
      handler: incomingMiddleware(bp),
      order: 15,
      module: 'botpress-subscription',
      description: 'Subscribes and unsubscribes users to the defined Subscriptions.'
    })

    bp.subscription = {
      subscribe: db(bp).subscribe,
      unsubscribe: db(bp).unsubscribe,
      isSubscribed: db(bp).isSubscribed,
      getSubscribed: db(bp).getSubscribed
    }
    
    db(bp).bootstrap()
    .then(db(bp).listAll)
    .then(subs => subscriptions = subs)

    config.loadAll()
    .then(c => cached_config = c)
  },

  ready: function(bp, config) {
    const router = bp.getRouter('botpress-subscription')
    
    const updateSubs = () => {
      return db(bp).listAll()
      .then(subs => subscriptions = subs)
    }

    router.get('/config', (req, res) => {
      config.loadAll()
      .then(c => {
        cached_config = c
        res.send(cached_config)
      })
    })

    router.post('/config', (req, res) => {
      config.saveAll(req.body)
      .then(() => config.loadAll())
      .then(c => cached_config = c)
      .then(() => res.sendStatus(200))
    })

    router.get('/subscriptions', (req, res) => {
      db(bp).listAll()
      .then(subs => res.send(subs))
    })

    router.put('/subscriptions/:category', (req, res) => {
      db(bp).create(req.params.category)
      .then(() => res.sendStatus(200))
      .then(updateSubs)
    })

    router.post('/subscriptions/:id', (req, res) => {
      db(bp).modify(req.params.id, req.body)
      .then(() => res.sendStatus(200))
      .then(updateSubs)
    })

    router.delete('/subscriptions/:id', (req, res) => {
      db(bp).delete(req.params.id)
      .then(() => res.sendStatus(200))
      .then(updateSubs)
    })

  }
}
