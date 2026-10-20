const API_BASE = 'https://www.v2ex.com/api'

function createV2exService(requestData) {
  async function requestJson(url) {
    try {
      return await requestData(url)
    } catch (error) {
      if (error instanceof Error && /^(V2EX 服务暂时不可用|当前 (Windows|macOS) 使用自动代理配置|(Windows|macOS) HTTPS 系统代理已启用)/.test(error.message)) throw error
      throw new Error('无法连接到 V2EX，请检查网络或代理连接后重试。')
    }
  }

  return {
    getTopics(kind) {
      if (kind !== 'hot' && kind !== 'latest') throw new Error('无效的 V2EX 帖子类型。')
      return requestJson(`${API_BASE}/topics/${kind}.json`)
    },
    getTopic(topicId) {
      return requestJson(`${API_BASE}/topics/show.json?id=${encodeURIComponent(topicId)}`)
    },
    getReplies(topicId) {
      return requestJson(`${API_BASE}/replies/show.json?topic_id=${encodeURIComponent(topicId)}`)
    }
  }
}

module.exports = { createV2exService }
