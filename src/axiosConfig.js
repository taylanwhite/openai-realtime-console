import axios from 'axios';

// Create an Axios instance
const axiosInstance = axios.create({
  baseURL: 'https://vsfy.com', // Replace with your actual base URL
  // Add other custom settings here
});

// Add a request interceptor
axiosInstance.interceptors.request.use(
  function (config) {
    if (!config.url.includes('upload')) {
      // Retrieve the color object from localStorage
      const colorStorage = localStorage.getItem('color');
      let sid = null;

      if (colorStorage) {
        const color = JSON.parse(colorStorage);
        sid = color.id;
      }

      if (sid) {
        config.headers.Authorization = sid; // Attach the SID to headers
      }
    }
    return config;
  },
  function (error) {
    return Promise.reject(error);
  }
);

export default axiosInstance;
