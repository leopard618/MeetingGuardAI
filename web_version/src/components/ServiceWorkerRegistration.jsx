import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    // Register service worker for background persistence
    if ('serviceWorker' in navigator) {
      // Create service worker code as a blob
      const serviceWorkerCode = `
        // Alert Service Worker for persistent meeting reminders
        const CACHE_NAME = 'meeting-guard-alerts-v1';

        // Install service worker
        self.addEventListener('install', (event) => {
          console.log('Alert service worker installed');
          self.skipWaiting();
        });

        // Activate service worker
        self.addEventListener('activate', (event) => {
          console.log('Alert service worker activated');
          event.waitUntil(self.clients.claim());
        });

        // Handle background sync for alerts
        self.addEventListener('sync', (event) => {
          if (event.tag === 'meeting-alert-sync') {
            event.waitUntil(checkPendingAlerts());
          }
        });

        // Handle push notifications (if available)
        self.addEventListener('push', (event) => {
          const data = event.data ? event.data.json() : {};
          
          const options = {
            body: data.body || 'You have an upcoming meeting!',
            icon: '/icon-192x192.png',
            badge: '/badge-72x72.png',
            vibrate: [200, 100, 200, 100, 200, 100, 200],
            requireInteraction: true,
            actions: [
              {
                action: 'view',
                title: 'View Meeting'
              },
              {
                action: 'snooze',
                title: 'Snooze 5min'
              }
            ]
          };
          
          event.waitUntil(
            self.registration.showNotification('Meeting Alert', options)
          );
        });

        // Handle notification clicks
        self.addEventListener('notificationclick', (event) => {
          event.notification.close();
          
          if (event.action === 'view') {
            event.waitUntil(
              self.clients.openWindow('/')
            );
          } else if (event.action === 'snooze') {
            console.log('Meeting snoozed for 5 minutes');
          }
        });

        // Check for pending alerts
        async function checkPendingAlerts() {
          try {
            console.log('Checking for pending meeting alerts...');
            
            const windowClients = await self.clients.matchAll({ type: 'window' });
            if (windowClients.length === 0) {
              await self.clients.openWindow('/');
            }
          } catch (error) {
            console.error('Failed to check pending alerts:', error);
          }
        }

        // Periodic alert checking
        setInterval(() => {
          checkPendingAlerts();
        }, 60 * 1000);
      `;

      // Create blob URL for service worker
      const blob = new Blob([serviceWorkerCode], { type: 'application/javascript' });
      const serviceWorkerUrl = URL.createObjectURL(blob);

      navigator.serviceWorker.register(serviceWorkerUrl)
        .then(registration => {
          console.log('Alert service worker registered:', registration);
        })
        .catch(error => {
          console.log('Alert service worker registration failed:', error);
        });
    }
  }, []);

  return null; // This component doesn't render anything
}