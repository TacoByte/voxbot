import { Component } from 'preact'
import Icon, { CubeIcon } from './components/icons/icons'

import Head from './components/head'
import WompsList from './womps-list'

interface Props {
  path?: string
}

export default class WompsPage extends Component<Props> {
  render() {
    return (
      <section>
        <Head title={'Womps'} />

        <h1><CubeIcon name="womps" /> Womps</h1>

        <WompsList hint={'No womps found'} numberToShow={42} collapsed={false} fetch="/womps.json" ttl={600} />
      </section>
    )
  }
}
