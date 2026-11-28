import { Card } from "flowbite-react";
import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
const API = import.meta.env.VITE_API_URL;

const Shop = () => {
  const [books, setBooks] = useState([]);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  useEffect(() => {
    fetch(`${API}/all-books`).then(res => res.json()).then(data => setBooks(data.books || []));
  }, [])
  return (
    <div className='mt-28 px-4 lg:px-24'>
      <h2 className='text-5xl font-bold text-center'>All Books are Here</h2>
      <div className='grid gap-8 my-12 lg:grid-cols-4 sm:grid-cols-2 md:grid-cols-3 grid-cols-1'>
        {
          books.map(book => <Card key={book._id}>
            <img src={book.imageURL} alt="" className='h-96' />
            <h5 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              {book.bookTitle}
            </h5>
            <p className="font-normal text-gray-700 dark:text-gray-400">
              {book.bookDescription}
            </p>
            <button
              onClick={() => user ? navigate(`/book/${book._id}`) : navigate('/login')}
              className='bg-blue-700 font-semibold text-white py-2 rounded'
            >
              Buy Now
            </button>
          </Card>)
        }
      </div>
    </div>
  )
}

export default Shop