import React, { useEffect, useState } from "react";
import { Table } from "flowbite-react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

const API = import.meta.env.VITE_API_URL;

const ManageBooks = () => {
  const [ allBooks,setAllBooks ] = useState([]);
  const getToken = useAuthStore((s) => s.getToken);

  useEffect(()=>{
    fetch(`${API}/all-books`).then(res=>res.json()).then(data=> setAllBooks(data.books || []));
  },[])

  //Delete a book
  const handleDelete = async (id) => {
    const token = await getToken();
    fetch(`${API}/book/${id}`,{
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).then(res => res.json()).then(data=>{
      alert("Book is Deleted successfully")
      // Remove the deleted book from the list immediately
      setAllBooks(prev => prev.filter(b => b._id !== id));
    })
  }
  return (
    <div className="px-4 my-12">
      <h2 className="mb-8 text-3xl font-bold">Manage Your Books</h2>
      {/*Table*/}
      <Table className="lg:w-[0px]">
        <Table.Head>
          <Table.HeadCell>No.</Table.HeadCell>
          <Table.HeadCell>Book Name</Table.HeadCell>
          <Table.HeadCell>Author Name</Table.HeadCell>
          <Table.HeadCell>Category</Table.HeadCell>
          <Table.HeadCell>Prices</Table.HeadCell>
          <Table.HeadCell>
            <span>Edit or Manage</span>
          </Table.HeadCell>
        </Table.Head>
        {
          allBooks.map((book,index) => <Table.Body className="divide-y" key={book._id}>
            <Table.Row className="bg-white dark:border-gray-700 dark:bg-gray-800">
            <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
             {index+1}
            </Table.Cell>
            <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
              {book.bookTitle}
            </Table.Cell>
            <Table.Cell>{book.authorName}</Table.Cell>
            <Table.Cell>{book.category}</Table.Cell>
            <Table.Cell>{book.price ? `₹${book.price}` : "N/A"}</Table.Cell>
            <Table.Cell>
              <Link className="font-medium text-cyan-600 hover:underline dark:text-cyan-500 mr-5"
               to={`/admin/dashboard/edit-books/${book._id}`}
              >
                Edit
                </Link>
                <button onClick={() => handleDelete(book._id)}className="bg-red-600 px-4 py-1 font-semibold text-white rounded-sm hover:bg-sky-600">Delete</button>
            </Table.Cell>
          </Table.Row>
          </Table.Body>)
        }
       
      </Table>
      
    </div>
  );
};

export default ManageBooks;
