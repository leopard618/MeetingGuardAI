// Google Maps Integration Service
// Handles location selection, geocoding, and map integration for on-site meetings

class GoogleMapsService {
  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
    this.baseUrl = 'https://maps.googleapis.com/maps/api';
  }

  /**
   * Search for locations using Google Places API
   */
  async searchLocations(query, options = {}) {
    try {
      if (!this.apiKey) {
        // Fallback to mock data for development
        return this.getMockLocations(query);
      }

      const params = new URLSearchParams({
        input: query,
        key: this.apiKey,
        types: options.types || 'establishment',
        language: options.language || 'en',
        ...options
      });

      const response = await fetch(
        `${this.baseUrl}/place/autocomplete/json?${params}`
      );

      if (!response.ok) {
        throw new Error(`Google Places API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status !== 'OK') {
        throw new Error(`Google Places API error: ${data.status}`);
      }

      return data.predictions.map(prediction => ({
        id: prediction.place_id,
        name: prediction.structured_formatting?.main_text || prediction.description,
        address: prediction.structured_formatting?.secondary_text || '',
        fullAddress: prediction.description,
        types: prediction.types || []
      }));
    } catch (error) {
      console.error('Error searching locations:', error);
      // Fallback to mock data
      return this.getMockLocations(query);
    }
  }

  /**
   * Get location details by place ID
   */
  async getLocationDetails(placeId) {
    try {
      if (!this.apiKey) {
        // Fallback to mock data
        return this.getMockLocationDetails(placeId);
      }

      const params = new URLSearchParams({
        place_id: placeId,
        key: this.apiKey,
        fields: 'name,formatted_address,geometry,place_id,types,website,formatted_phone_number'
      });

      const response = await fetch(
        `${this.baseUrl}/place/details/json?${params}`
      );

      if (!response.ok) {
        throw new Error(`Google Places API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status !== 'OK') {
        throw new Error(`Google Places API error: ${data.status}`);
      }

      const place = data.result;
      return {
        id: place.place_id,
        name: place.name,
        address: place.formatted_address,
        location: {
          lat: place.geometry?.location?.lat,
          lng: place.geometry?.location?.lng
        },
        types: place.types || [],
        website: place.website,
        phone: place.formatted_phone_number,
        mapUrl: `https://maps.google.com/?q=${place.geometry?.location?.lat},${place.geometry?.location?.lng}`,
        directionsUrl: `https://maps.google.com/directions?daddr=${place.geometry?.location?.lat},${place.geometry?.location?.lng}`
      };
    } catch (error) {
      console.error('Error getting location details:', error);
      return this.getMockLocationDetails(placeId);
    }
  }

  /**
   * Geocode an address to get coordinates
   */
  async geocodeAddress(address) {
    try {
      if (!this.apiKey) {
        // Fallback to mock geocoding
        return this.getMockGeocode(address);
      }

      const params = new URLSearchParams({
        address: address,
        key: this.apiKey
      });

      const response = await fetch(
        `${this.baseUrl}/geocode/json?${params}`
      );

      if (!response.ok) {
        throw new Error(`Google Geocoding API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status !== 'OK') {
        throw new Error(`Google Geocoding API error: ${data.status}`);
      }

      const result = data.results[0];
      return {
        address: result.formatted_address,
        location: {
          lat: result.geometry?.location?.lat,
          lng: result.geometry?.location?.lng
        },
        placeId: result.place_id,
        types: result.types || []
      };
    } catch (error) {
      console.error('Error geocoding address:', error);
      return this.getMockGeocode(address);
    }
  }

  /**
   * Reverse geocode coordinates to get address
   */
  async reverseGeocode(lat, lng) {
    try {
      if (!this.apiKey) {
        return this.getMockReverseGeocode(lat, lng);
      }

      const params = new URLSearchParams({
        latlng: `${lat},${lng}`,
        key: this.apiKey
      });

      const response = await fetch(
        `${this.baseUrl}/geocode/json?${params}`
      );

      if (!response.ok) {
        throw new Error(`Google Geocoding API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.status !== 'OK') {
        throw new Error(`Google Geocoding API error: ${data.status}`);
      }

      const result = data.results[0];
      return {
        address: result.formatted_address,
        location: { lat, lng },
        placeId: result.place_id,
        types: result.types || []
      };
    } catch (error) {
      console.error('Error reverse geocoding:', error);
      return this.getMockReverseGeocode(lat, lng);
    }
  }

  /**
   * Generate Google Maps URL for a location
   */
  generateMapUrl(location) {
    if (location.lat && location.lng) {
      return `https://maps.google.com/?q=${location.lat},${location.lng}`;
    } else if (location.address) {
      return `https://maps.google.com/?q=${encodeURIComponent(location.address)}`;
    }
    return null;
  }

  /**
   * Generate directions URL
   */
  generateDirectionsUrl(destination, origin = null) {
    let url = 'https://maps.google.com/directions?';
    
    if (origin) {
      url += `saddr=${encodeURIComponent(origin)}&`;
    }
    
    if (destination.lat && destination.lng) {
      url += `daddr=${destination.lat},${destination.lng}`;
    } else if (destination.address) {
      url += `daddr=${encodeURIComponent(destination.address)}`;
    }
    
    return url;
  }

  // Mock data for development (when API key is not available)
  getMockLocations(query) {
    const mockLocations = [
      {
        id: 'mock-office-1',
        name: 'Tech Office Building',
        address: '123 Innovation Street, Tech City',
        fullAddress: '123 Innovation Street, Tech City, TC 12345',
        types: ['establishment', 'point_of_interest']
      },
      {
        id: 'mock-office-2',
        name: 'Business Center',
        address: '456 Corporate Avenue, Business District',
        fullAddress: '456 Corporate Avenue, Business District, BD 67890',
        types: ['establishment', 'point_of_interest']
      },
      {
        id: 'mock-office-3',
        name: 'Co-working Space',
        address: '789 Startup Lane, Innovation Hub',
        fullAddress: '789 Startup Lane, Innovation Hub, IH 11111',
        types: ['establishment', 'point_of_interest']
      }
    ];

    return mockLocations.filter(location =>
      location.name.toLowerCase().includes(query.toLowerCase()) ||
      location.address.toLowerCase().includes(query.toLowerCase())
    );
  }

  getMockLocationDetails(placeId) {
    const mockDetails = {
      'mock-office-1': {
        id: 'mock-office-1',
        name: 'Tech Office Building',
        address: '123 Innovation Street, Tech City, TC 12345',
        location: { lat: 40.7128, lng: -74.0060 },
        types: ['establishment', 'point_of_interest'],
        website: 'https://techoffice.example.com',
        phone: '+1 (555) 123-4567',
        mapUrl: 'https://maps.google.com/?q=40.7128,-74.0060',
        directionsUrl: 'https://maps.google.com/directions?daddr=40.7128,-74.0060'
      },
      'mock-office-2': {
        id: 'mock-office-2',
        name: 'Business Center',
        address: '456 Corporate Avenue, Business District, BD 67890',
        location: { lat: 40.7589, lng: -73.9851 },
        types: ['establishment', 'point_of_interest'],
        website: 'https://businesscenter.example.com',
        phone: '+1 (555) 987-6543',
        mapUrl: 'https://maps.google.com/?q=40.7589,-73.9851',
        directionsUrl: 'https://maps.google.com/directions?daddr=40.7589,-73.9851'
      },
      'mock-office-3': {
        id: 'mock-office-3',
        name: 'Co-working Space',
        address: '789 Startup Lane, Innovation Hub, IH 11111',
        location: { lat: 40.7505, lng: -73.9934 },
        types: ['establishment', 'point_of_interest'],
        website: 'https://coworking.example.com',
        phone: '+1 (555) 456-7890',
        mapUrl: 'https://maps.google.com/?q=40.7505,-73.9934',
        directionsUrl: 'https://maps.google.com/directions?daddr=40.7505,-73.9934'
      }
    };

    return mockDetails[placeId] || mockDetails['mock-office-1'];
  }

  getMockGeocode(address) {
    return {
      address: address,
      location: { lat: 40.7128, lng: -74.0060 },
      placeId: 'mock-place-id',
      types: ['establishment']
    };
  }

  getMockReverseGeocode(lat, lng) {
    return {
      address: '123 Mock Street, Mock City, MC 12345',
      location: { lat, lng },
      placeId: 'mock-place-id',
      types: ['establishment']
    };
  }
}

export default new GoogleMapsService();
