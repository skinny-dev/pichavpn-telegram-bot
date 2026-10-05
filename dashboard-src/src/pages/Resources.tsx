import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataGrid } from '@/components/DataGrid'
import { TreeView } from '@/components/TreeView'
import { useSession } from '@/lib/session'

export function Users() {
  const { schema } = useSession()
  return <DataGrid resName="users" res={schema.users} filterCols={['agent', 'User_Status']} />
}

export function Orders() {
  const { schema } = useSession()
  return <DataGrid resName="orders" res={schema.orders} />
}

export function Products() {
  const { schema } = useSession()
  return (
    <Tabs defaultValue="tree">
      <TabsList><TabsTrigger value="tree">نمای درختی</TabsTrigger><TabsTrigger value="table">جدول محصولات</TabsTrigger><TabsTrigger value="cats">دسته‌بندی‌ها</TabsTrigger></TabsList>
      <TabsContent value="tree"><TreeView schema={schema} /></TabsContent>
      <TabsContent value="table"><DataGrid resName="products" res={schema.products} filterCols={['agent']} /></TabsContent>
      <TabsContent value="cats"><DataGrid resName="categories" res={schema.categories} /></TabsContent>
    </Tabs>
  )
}

export function Accounting() {
  const { schema } = useSession()
  return (
    <Tabs defaultValue="expenses">
      <TabsList><TabsTrigger value="expenses">هزینه‌ها</TabsTrigger><TabsTrigger value="capital">ورود سرمایه</TabsTrigger><TabsTrigger value="payments">پرداخت‌ها</TabsTrigger></TabsList>
      <TabsContent value="expenses"><DataGrid resName="expenses" res={schema.expenses} /></TabsContent>
      <TabsContent value="capital"><DataGrid resName="capital" res={schema.capital} /></TabsContent>
      <TabsContent value="payments"><DataGrid resName="payments" res={schema.payments} /></TabsContent>
    </Tabs>
  )
}
