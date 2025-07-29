// Local Storage API Client to replace base44 functionality
class LocalStorageAPI {
  constructor() {
    this.storageKey = 'meetingguard_data';
    this.initializeStorage();
  }

  initializeStorage() {
    if (!localStorage.getItem(this.storageKey)) {
      localStorage.setItem(this.storageKey, JSON.stringify({
        meetings: [],
        userPreferences: [],
        apiKeys: [],
        notes: [],
        users: []
      }));
    }
  }

  getData() {
    return JSON.parse(localStorage.getItem(this.storageKey) || '{}');
  }

  setData(data) {
    localStorage.setItem(this.storageKey, JSON.stringify(data));
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  getCurrentUser() {
    const data = this.getData();
    return data.users.find(user => user.isCurrent) || {
      id: 'default-user',
      email: 'user@example.com',
      name: 'Default User',
      isCurrent: true
    };
  }
}

export const localStorageAPI = new LocalStorageAPI();