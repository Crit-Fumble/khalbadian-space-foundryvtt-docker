/// Hook modifyDocument events
/// we need to hijack them and redirect the save location
export const hookModifyDocument = () => {
  const origDispatch = SocketInterface.prototype.constructor.dispatch
  SocketInterface.prototype.constructor.dispatch = function (eventName, request) {
    // log and report error for unexpected behaviour for further investigation
    const reportError = (...args) => {
      console.error(...args)
      ui.notifications.error(game.i18n.localize('stairways.ui.messages.data-update-error'))
    }

    if (eventName === 'modifyDocument' && request.type === 'Scene') {
      // send event
      const response = origDispatch.bind(this)(eventName, request)

      // keep request data
      let data = []
      if (request.action === 'create') {
        data = request.data
      } else if (request.action === 'update') {
        data = request.updates
      } else {
        // ignore get + delete
        if (request.action !== 'get' && request.action !== 'delete') {
          console.error('unknown request action', request.action)
        }

        // return unmodified request/response
        return response
      }

      // hook response
      return new Promise((resolve, reject) => {
        response.then(value => {
          // verify data length
          if (data.length !== value.result.length) {
            return reportError('request / response data length missmatch', request, value)
          }

          // inject stairways into scene from flags
          for (let i = 0; i < data.length; i++) {
            if ('flags' in data[i]) {
              value.result[i].stairways = foundry.utils.duplicate(data[i].flags.stairways || [])
            }
          }

          // return data
          resolve(value)
        })
      })
    } else if (eventName === 'modifyDocument' && request.type === 'Stairway') {
      return new Promise((resolve, reject) => {
        // parent scene
        const sceneId = request.parentUuid.split('.')[1]
        const scene = game.scenes.get(sceneId)

        // process stairways events
        const stairways = foundry.utils.duplicate(scene.stairways._source || [])
        const result = []

        if (request.action === 'create') {
          for (const entry of request.data) {
            const stairway = foundry.utils.duplicate(entry)
            // add new stairway with random ID
            stairway._id = foundry.utils.randomID(16)
            stairways.push(stairway)
            result.push(stairway)
          }
        } else if (request.action === 'update') {
          for (const update of request.updates) {
            const idx = stairways.findIndex(oldStairway => oldStairway._id === update._id)
            if (idx < 0) {
              return reportError('missing stairway to update', update, stairways)
            }
            stairways[idx] = foundry.utils.mergeObject(stairways[idx], update)
            result.push(stairways[idx])
          }
        } else if (request.action === 'delete') {
          for (const id of request.ids) {
            const idx = stairways.findIndex(oldStairway => oldStairway._id === id)
            if (idx < 0) {
              return reportError('missing stairway to delete', id, stairways)
            }
            stairways.splice(idx, 1)
            result.push(id)
          }
        } else {
          return reportError('unknown request action', request.action)
        }

        // update stairways
        scene.update({ 'flags.stairways': stairways })

        // create fake backend response
        const response = { request, result, userId: game.userId }
        resolve(response)

        // send stairway update event
        game.socket.emit('module.stairways', { eventName, data: response })
      })
    } else {
      return origDispatch.bind(this)(eventName, request)
    }
  }
}

export const handleModifyEmbeddedDocument = (response) => {
  // skip own events
  if (response.userId === game.userId) {
    return
  }

  const db = CONFIG.DatabaseBackend

  switch (response.request.action) {
    case 'create':
      db._handleCreateEmbeddedDocuments(response)
      break
    case 'update':
      db._handleUpdateEmbeddedDocuments(response)
      break
    case 'delete':
      db._handleDeleteEmbeddedDocuments(response)
      break
  }
}
